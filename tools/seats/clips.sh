#!/bin/sh
# Makes camera clips of real hands for players sharing one camera, from a recording of one person holding two
# fists up like a wheel (3:2, the person in the middle, such as the maintainer's moves.mov, which is not in the
# repository: recordings of people never are, and neither are the clips made from them).
#
#   tools/seats/clips.sh path/to/moves.mov /some/folder/outside/the/repo
#   SEATS_CLIPS=/some/folder/outside/the/repo npx playwright test e2e/seats.spec.ts
#
# Makes, as 1280x720 Y4M videos for Chrome's fake camera (--use-file-for-fake-video-capture):
#   alone-right.y4m   the person in the camera's right half, the left half an empty wall (a player alone on the
#                     left of the mirrored picture: where the phantom hand in the empty seat was seen)
#   alone-left.y4m    the person in the camera's left half
#   pair.y4m          the person on the left and the same recording, shifted three seconds, on the right
set -e
src="$1"
out="$2"
[ -n "$src" ] && [ -n "$out" ] || { echo "usage: $0 recording.mov outdir" >&2; exit 1; }
mkdir -p "$out"
# The middle of the recording (the two fists and the torso), at the camera's height: 540x720.
person="crop=iw/3*1.5:ih:iw/4:0,scale=540:720"
wall="color=c=0xc9a98a:s=640x720:r=20"
# One column: the person centred on a 640-wide stretch of wall.
column() { echo "[$1:v]fps=20,$person[p$2];[p$2]pad=640:720:50:0:0xc9a98a[c$2]"; }
common="-v error -y -pix_fmt yuv420p -t 5"
ffmpeg $common -i "$src" -f lavfi -i "$wall" -filter_complex "$(column 0 a);[1:v]null[w];[w][ca]hstack[out]" -map "[out]" "$out/alone-right.y4m"
ffmpeg $common -i "$src" -f lavfi -i "$wall" -filter_complex "$(column 0 a);[ca][1:v]hstack[out]" -map "[out]" "$out/alone-left.y4m"
ffmpeg $common -i "$src" -ss 3 -i "$src" -filter_complex "$(column 0 a);$(column 1 b);[ca][cb]hstack[out]" -map "[out]" "$out/pair.y4m"
ls -la "$out"
