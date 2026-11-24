#!/bin/sh
# Start as root only long enough to work out which groups own the GPU render
# nodes, then drop to the unprivileged "node" user with exactly those groups.
# Host render/video GIDs differ between distros (e.g. 44/105/992/109), so they
# are read from the mounted /dev/dri instead of being hard-coded in the image.
# If the container is already started non-root (compose `user:`), run as-is and
# supply the GIDs with `group_add` instead.
set -eu

if [ "$(id -u)" != "0" ]; then
  exec "$@"
fi

groups=""
for dev in /dev/dri/renderD* /dev/dri/card*; do
  [ -e "$dev" ] || continue
  gid=$(stat -c %g "$dev")
  # A root-owned node would mean handing node the root group; skip it.
  [ "$gid" != "0" ] || continue
  case ",$groups," in
    *",$gid,"*) ;;
    *) groups="${groups:+$groups,}$gid" ;;
  esac
done

if [ -z "$groups" ]; then
  if [ "${HW_ACCEL:-qsv}" = "qsv" ]; then
    echo "[entrypoint] no group-accessible /dev/dri nodes found; QSV needs devices: - /dev/dri:/dev/dri" >&2
  fi
  exec setpriv --reuid=node --regid=node --clear-groups -- "$@"
fi

exec setpriv --reuid=node --regid=node --groups "$groups" -- "$@"
