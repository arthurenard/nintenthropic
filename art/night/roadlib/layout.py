"""Where everything on Route 9 stands. One table, so the builders, the
contract nodes, the bake groups and the review cameras all agree.

Blender coordinates (metres): the player's feet at the origin, eyes at
1.7 m, looking north (+Y) up Route 9; +X is east (the player's right).

    ... fog ...                           drive-in screen on the hill (300 m)
                water tower (170 m, left)
        windmill   silo                     pines
           barn (60 m)                      pines
      corn  corn   |      bus (45 m)        | Starlite Motel (40 m)
      scarecrow    |=======================| motel sign
    ===farm road===+====== crossroads (25 m) ====+===== to the motel
      corn  corn   |  streetlight  phone booth
      fence        |        GAS & EATS pole sign
      corn         |                    Miller's Gas & Eats (diner wing,
         pickup    |                    the radio in its window)
      [sandbags][pump][bags]   <- the barricade (3 m)
                 you (under the canopy)
"""

# ---------------------------------------------------------------------------
# Roads

ROAD_X = -0.6            # Route 9's centre line
LANE_W = 3.3             # each lane
ROAD_HALF = LANE_W + 0.3  # asphalt edge from the centre line (incl. edge strip)
SHOULDER = 1.0           # gravel beyond the asphalt
CROSS_Y = 25.0           # the crossroads' centre line
CROSS_HALF = 3.3         # the county road's half width
FARM_ROAD_X = -12.0      # west of here the county road is gravel (the farm road)

# the station's concrete apron
APRON = (-10.0, 6.5, -9.0, 6.6)      # x0, x1, y0, y1
# a concrete strip along the diner's front, north to the building's end
APRON_STRIP = (3.0, 6.5, 6.6, 13.8)

# ---------------------------------------------------------------------------
# The barricade and the canopy

BARRICADE_Y = (2.55, 3.35)           # the sandbag wall's footprint (y0, y1)
BAG_TOP = 1.05                        # height of the bag wall
PUMP_ISLAND = (1.25, 3.35, 2.35, 3.75)   # x0, x1, y0, y1 (concrete curb island)
PUMP = (1.72, 3.0)                    # the barricade pump
BIN = (2.95, 3.05)                    # an oil drum on the island's far end
# the pickup lies on its side along the west end of the barricade, its
# underside (wheels, chassis) toward the road; its east edge stays west of
# the sightline to the fence spawn
TRUCK = dict(tail=(-5.1, 2.6), front=(-3.81, 7.33))
CANOPY = (-5.6, 6.2, -6.0, 6.0, 4.35)   # x0, x1, y0, y1 (front fascia), soffit height
CANOPY_POSTS = [(-3.9, 5.5), (5.4, 5.35), (-3.9, -4.6), (5.4, -4.6)]

# ---------------------------------------------------------------------------
# The station: Miller's Gas & Eats (the diner wing runs north along the road)

STATION = (6.5, 15.0, -9.0, 13.8)    # x0 (the road-facing wall), x1, y0, y1
STATION_H = 4.1
DINER_WINDOW = (7.2, 12.9)           # y span of the big window (broken out)
RADIO = (8.5, 13.3, 1.32)            # on the shelf at the end of the counter, behind it
POLE_SIGN = (4.35, 15.6)             # the GAS & EATS sign's post
SIGN_Z = (4.95, 6.35)                # bottom and top of the letters' board

# ---------------------------------------------------------------------------
# The crossroads

STREETLIGHT_POLE = (4.9, 20.5)
STREETLIGHT_HEAD = (2.35, 22.3, 8.1)
BOOTH = (6.75, 19.35)                # phone booth centre; its door faces the road (west)
STOP_SIGNS = [(-5.9, 20.9), (5.5, 29.1)]

# ---------------------------------------------------------------------------
# The Starlite Motel (faces south, toward the player, across its lot)

MOTEL_Y = 40.0                       # facade line
MOTEL_OFFICE = (8.6, 12.8)           # x span of the office
MOTEL_ROOMS_X0 = 12.8
MOTEL_ROOM_W = 3.2
MOTEL_DEPTH = 7.5
MOTEL_SIGN = (7.2, 34.6)
MOTEL_CANDLES = [2, 4, 5]            # rooms with a candle in the window (1-based)
MOTEL_AJAR = [3, 6]                  # rooms whose door stands open

# ---------------------------------------------------------------------------
# West: fence, corn, farm

FENCE_X = -7.3
FENCE_SPANS = [(7.2, 21.0), (29.3, 92.0)]
FENCE_GAPS = [(36.0, 38.4)]   # broken rails where the corn lane comes through
FENCE_SPAWN_Y = 14.6         # where they climb over (16 m out; the pickup hides anything nearer)
CORN = [(-62.0, -9.3, 4.0, 20.6), (-58.0, -9.3, 29.6, 47.0)]   # x0, x1, y0, y1 blocks
SCARECROW = (-11.9, 33.4)            # near the field's edge: the corn would hide it deeper in
BARN = (-31.0, 55.0)                 # centre; big doors face east
SILO = (-19.5, 63.0)
WINDMILL = (-45.0, 71.0)
WATER_TOWER = (-58.0, 172.0)

# ---------------------------------------------------------------------------
# Far

BUS = (-0.4, 45.0)                   # centre; sideways across the road, front to the east
BUS_ANGLE_DEG = 82.0                 # its long axis from +Y (so it lies nearly along X)
WRECK_CAR = (-4.9, 31.5)
MOTEL_CAR = (21.0, 33.5)
DRIVEIN_SCREEN = (-26.0, 300.0)
DRIVEIN_BOOTH = (-23.0, 236.0)

# power line along the west side (and a branch across the crossroads)
POLES_WEST_X = -9.0
POLES_WEST_Y = [11.0, 45.0, 79.0, 113.0, 147.0, 181.0]
POLES_BRANCH = [(8.2, 26.8), (26.0, 30.5)]

# ---------------------------------------------------------------------------
# The moon: low in front and to the left, behind thin cloud. Low enough to
# be in the picture (the secret shoots it), so its light rakes the wet road
# toward the player and rims everything that walks out of the fog.

MOON_AZ_DEG = -24.0      # from +Y (straight up the road), negative = left (west)
MOON_EL_DEG = 14.0
MOON_DISC_DIST = 380.0   # moon.disc: within the game's far plane
