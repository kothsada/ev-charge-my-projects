#!/bin/bash

#!/bin/bash
SOURCE="/opt/QtMc/cg_config.ini"
TARGET="/etc/QMC021/cg_config.ini"

if [ -f "$TARGET" ]; then
  rm -f "$TARGET"
  echo "Existing target file removed: $TARGET"
fi

cp "$SOURCE" "$TARGET"
echo "Successfully moved: $SOURCE -> $TARGET"
echo "Done!"
