"""A tiny node-tree DSL so the material code reads like a recipe instead of
hundreds of lines of socket plumbing.

Every helper takes the tree wrapper `g` and returns an *output socket*, so
expressions compose: g.mul(g.noise(v, 4), 0.5).
"""

import bpy


class G:
    def __init__(self, tree):
        self.t = tree
        self.nodes = tree.nodes
        self.links = tree.links
        self._x = 0

    # -- plumbing -----------------------------------------------------------
    def new(self, typ, **props):
        n = self.nodes.new(typ)
        n.location = (self._x, 0)
        self._x += 40
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def set_in(self, node, key, val):
        """Connect a socket or set a default. key: name, identifier or index."""
        sock = self._input(node, key)
        if val is None:
            return
        if isinstance(val, bpy.types.NodeSocket):
            self.links.new(val, sock)
        else:
            if hasattr(sock, "default_value"):
                dv = sock.default_value
                if isinstance(val, (int, float)) and hasattr(dv, "__len__"):
                    n = len(dv)
                    val = [val] * n if n != 4 else [val, val, val, 1.0]
                elif hasattr(dv, "__len__") and len(val) == 3 and len(dv) == 4:
                    val = (*val, 1.0)
                sock.default_value = val

    def _input(self, node, key):
        if isinstance(key, int):
            return node.inputs[key]
        for s in node.inputs:
            if s.identifier == key and s.enabled:
                return s
        for s in node.inputs:
            if s.name == key and s.enabled:
                return s
        for s in node.inputs:
            if s.identifier == key or s.name == key:
                return s
        raise KeyError(f"{node.bl_idname} has no input {key!r}: {[s.identifier for s in node.inputs]}")

    def out(self, node, key=0):
        if isinstance(key, int):
            outs = [s for s in node.outputs if s.enabled]
            return outs[key]
        for s in node.outputs:
            if (s.identifier == key or s.name == key) and s.enabled:
                return s
        for s in node.outputs:
            if s.identifier == key or s.name == key:
                return s
        raise KeyError(f"{node.bl_idname} has no output {key!r}")

    def node(self, typ, inputs=None, out=0, **props):
        n = self.new(typ, **props)
        for k, v in (inputs or {}).items():
            self.set_in(n, k, v)
        return self.out(n, out) if out is not None else n

    # -- inputs -------------------------------------------------------------
    def uv(self, name):
        return self.node('ShaderNodeUVMap', out='UV', uv_map=name)

    def attr(self, name, out='Fac', typ='GEOMETRY'):
        return self.node('ShaderNodeAttribute', out=out, attribute_name=name, attribute_type=typ)

    def geo(self, out='Position'):
        return self.node('ShaderNodeNewGeometry', out=out)

    def texco(self, out='Object'):
        return self.node('ShaderNodeTexCoord', out=out)

    def value(self, v):
        n = self.new('ShaderNodeValue')
        n.outputs[0].default_value = v
        return n.outputs[0]

    def rgb(self, c):
        n = self.new('ShaderNodeRGB')
        n.outputs[0].default_value = (*c, 1.0) if len(c) == 3 else c
        return n.outputs[0]

    # -- math ---------------------------------------------------------------
    def math(self, op, a, b=None, c=None, clamp=False):
        n = self.new('ShaderNodeMath', operation=op, use_clamp=clamp)
        self.set_in(n, 0, a)
        if b is not None:
            self.set_in(n, 1, b)
        if c is not None:
            self.set_in(n, 2, c)
        return n.outputs[0]

    def add(self, a, b, clamp=False):
        return self.math('ADD', a, b, clamp=clamp)

    def sub(self, a, b, clamp=False):
        return self.math('SUBTRACT', a, b, clamp=clamp)

    def mul(self, a, b, clamp=False):
        return self.math('MULTIPLY', a, b, clamp=clamp)

    def madd(self, a, b, c, clamp=False):
        return self.math('MULTIPLY_ADD', a, b, c, clamp=clamp)

    def clamp01(self, a):
        return self.math('ADD', a, 0.0, clamp=True)

    def maprange(self, v, fmin, fmax, tmin=0.0, tmax=1.0, interp='LINEAR', clamp=True):
        n = self.new('ShaderNodeMapRange', interpolation_type=interp, clamp=clamp)
        self.set_in(n, 'Value', v)
        self.set_in(n, 'From Min', fmin)
        self.set_in(n, 'From Max', fmax)
        self.set_in(n, 'To Min', tmin)
        self.set_in(n, 'To Max', tmax)
        return self.out(n, 'Result')

    def smooth(self, v, a, b):
        return self.maprange(v, a, b, 0.0, 1.0, interp='SMOOTHSTEP')

    def vmath(self, op, a, b=None, out=0):
        n = self.new('ShaderNodeVectorMath', operation=op)
        self.set_in(n, 0, a)
        if b is not None:
            self.set_in(n, 1, b)
        return n.outputs[out]

    def vadd(self, a, b):
        return self.vmath('ADD', a, b)

    def vmul(self, a, b):
        return self.vmath('MULTIPLY', a, b)

    def combine(self, x=0.0, y=0.0, z=0.0):
        n = self.new('ShaderNodeCombineXYZ')
        self.set_in(n, 'X', x)
        self.set_in(n, 'Y', y)
        self.set_in(n, 'Z', z)
        return n.outputs[0]

    def separate(self, v):
        n = self.new('ShaderNodeSeparateXYZ')
        self.set_in(n, 0, v)
        return n.outputs[0], n.outputs[1], n.outputs[2]

    def sep_rgb(self, c):
        n = self.new('ShaderNodeSeparateColor')
        self.set_in(n, 0, c)
        return n.outputs[0], n.outputs[1], n.outputs[2]

    # -- colour -------------------------------------------------------------
    def mix(self, fac, a, b, blend='MIX', clamp=True):
        n = self.new('ShaderNodeMix', data_type='RGBA', blend_type=blend, clamp_result=clamp)
        self.set_in(n, 'Factor_Float', fac)
        self.set_in(n, 'A_Color', a)
        self.set_in(n, 'B_Color', b)
        return self.out(n, 'Result_Color')

    def mixf(self, fac, a, b):
        n = self.new('ShaderNodeMix', data_type='FLOAT', clamp_factor=True)
        self.set_in(n, 'Factor_Float', fac)
        self.set_in(n, 'A_Float', a)
        self.set_in(n, 'B_Float', b)
        return self.out(n, 'Result_Float')

    def hsv(self, c, h=0.5, s=1.0, v=1.0, fac=1.0):
        n = self.new('ShaderNodeHueSaturation')
        self.set_in(n, 'Hue', h)
        self.set_in(n, 'Saturation', s)
        self.set_in(n, 'Value', v)
        self.set_in(n, 'Fac', fac)
        self.set_in(n, 'Color', c)
        return n.outputs[0]

    def ramp(self, fac, stops, interp='LINEAR', out='Color'):
        n = self.new('ShaderNodeValToRGB')
        cr = n.color_ramp
        cr.interpolation = interp
        els = cr.elements
        while len(els) > 1:
            els.remove(els[-1])
        for i, (pos, col) in enumerate(stops):
            e = els[0] if i == 0 else els.new(pos)
            e.position = pos
            e.color = (*col, 1.0) if len(col) == 3 else col
        self.set_in(n, 'Fac', fac)
        return self.out(n, out)

    # -- textures -----------------------------------------------------------
    def noise(self, vec, scale=5.0, detail=4.0, rough=0.5, dist=0.0, dims='3D', w=None,
              out='Fac', lac=2.0, ntype='FBM'):
        n = self.new('ShaderNodeTexNoise', noise_dimensions=dims)
        try:
            n.noise_type = ntype
        except Exception:
            pass
        if vec is not None:
            self.set_in(n, 'Vector', vec)
        if w is not None:
            self.set_in(n, 'W', w)
        self.set_in(n, 'Scale', scale)
        self.set_in(n, 'Detail', detail)
        self.set_in(n, 'Roughness', rough)
        self.set_in(n, 'Lacunarity', lac)
        self.set_in(n, 'Distortion', dist)
        return self.out(n, out)

    def wave(self, vec, scale=5.0, dist=0.0, detail=2.0, direction='X', profile='SIN',
             wtype='BANDS', dscale=1.0, out='Fac', phase=0.0):
        n = self.new('ShaderNodeTexWave', wave_type=wtype, wave_profile=profile)
        if wtype == 'BANDS':
            n.bands_direction = direction
        else:
            n.rings_direction = 'SPHERICAL' if direction == 'SPHERICAL' else direction
        if vec is not None:
            self.set_in(n, 'Vector', vec)
        self.set_in(n, 'Scale', scale)
        self.set_in(n, 'Distortion', dist)
        self.set_in(n, 'Detail', detail)
        self.set_in(n, 'Detail Scale', dscale)
        self.set_in(n, 'Phase Offset', phase)
        return self.out(n, out)

    def voronoi(self, vec, scale=5.0, feature='F1', rand=1.0, out='Distance', dims='3D',
                metric='EUCLIDEAN', detail=0.0):
        n = self.new('ShaderNodeTexVoronoi', feature=feature, voronoi_dimensions=dims,
                     distance=metric)
        if vec is not None:
            self.set_in(n, 'Vector', vec)
        self.set_in(n, 'Scale', scale)
        self.set_in(n, 'Randomness', rand)
        try:
            self.set_in(n, 'Detail', detail)
        except KeyError:
            pass
        return self.out(n, out)

    def brick(self, vec, c1, c2, mortar, scale=1.0, msize=0.01, width=0.5, height=0.25,
              offset=0.5, bias=0.0, msmooth=0.1, out='Color'):
        n = self.new('ShaderNodeTexBrick', offset=offset)
        self.set_in(n, 'Vector', vec)
        self.set_in(n, 'Color1', c1)
        self.set_in(n, 'Color2', c2)
        self.set_in(n, 'Mortar', mortar)
        self.set_in(n, 'Scale', scale)
        self.set_in(n, 'Mortar Size', msize)
        self.set_in(n, 'Mortar Smooth', msmooth)
        self.set_in(n, 'Bias', bias)
        self.set_in(n, 'Brick Width', width)
        self.set_in(n, 'Row Height', height)
        return self.out(n, out)

    def image(self, img, vec=None, out='Color', interp='Linear', extension='REPEAT'):
        n = self.new('ShaderNodeTexImage', interpolation=interp, extension=extension)
        n.image = img
        if vec is not None:
            self.set_in(n, 'Vector', vec)
        return self.out(n, out)

    def bump(self, height, strength=0.3, distance=0.01, normal=None):
        n = self.new('ShaderNodeBump')
        self.set_in(n, 'Height', height)
        self.set_in(n, 'Strength', strength)
        self.set_in(n, 'Distance', distance)
        if normal is not None:
            self.set_in(n, 'Normal', normal)
        return n.outputs[0]

    # -- shaders ------------------------------------------------------------
    def principled(self, base, rough=0.8, metal=0.0, normal=None, spec=0.5, alpha=None,
                   sheen=None, coat=None, subsurface=None, emission=None, estrength=None):
        n = self.new('ShaderNodeBsdfPrincipled')
        self.set_in(n, 'Base Color', base)
        self.set_in(n, 'Roughness', rough)
        self.set_in(n, 'Metallic', metal)
        self.set_in(n, 'Specular IOR Level', spec)
        if normal is not None:
            self.set_in(n, 'Normal', normal)
        if alpha is not None:
            self.set_in(n, 'Alpha', alpha)
        if sheen is not None:
            self.set_in(n, 'Sheen Weight', sheen)
        if coat is not None:
            self.set_in(n, 'Coat Weight', coat)
        if subsurface is not None:
            self.set_in(n, 'Subsurface Weight', subsurface)
        if emission is not None:
            self.set_in(n, 'Emission Color', emission)
            self.set_in(n, 'Emission Strength', 1.0 if estrength is None else estrength)
        return n.outputs[0]

    def output(self, shader, displacement=None):
        n = self.new('ShaderNodeOutputMaterial')
        self.links.new(shader, n.inputs['Surface'])
        if displacement is not None:
            self.links.new(displacement, n.inputs['Displacement'])
        return n


def new_material(name):
    m = bpy.data.materials.get(name)
    if m is not None:
        bpy.data.materials.remove(m)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes.clear()
    return m, G(m.node_tree)


def new_group(name, inputs, outputs):
    """Create a shader node group with typed interface sockets.
    inputs/outputs: list of (name, socket_type, default)."""
    grp = bpy.data.node_groups.get(name)
    if grp is not None:
        bpy.data.node_groups.remove(grp)
    grp = bpy.data.node_groups.new(name, 'ShaderNodeTree')
    for nm, typ, dv in inputs:
        s = grp.interface.new_socket(nm, in_out='INPUT', socket_type=typ)
        if dv is not None:
            s.default_value = (*dv, 1.0) if typ == 'NodeSocketColor' and len(dv) == 3 else dv
    for nm, typ, _ in outputs:
        grp.interface.new_socket(nm, in_out='OUTPUT', socket_type=typ)
    gin = grp.nodes.new('NodeGroupInput')
    gout = grp.nodes.new('NodeGroupOutput')
    g = G(grp)
    return grp, g, gin, gout


def group_node(g, grp, inputs=None):
    n = g.new('ShaderNodeGroup')
    n.node_tree = grp
    for k, v in (inputs or {}).items():
        g.set_in(n, k, v)
    return n
