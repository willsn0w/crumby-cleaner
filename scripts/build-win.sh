#!/usr/bin/env bash
# Builds dist/Crumby.exe (single-file, Windows x64) from Linux or macOS.
# Needs: curl, unzip, zip, go (1.21+), git.
set -euo pipefail

ELECTRON_VERSION=33.2.1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/.build"
mkdir -p "$WORK" "$ROOT/dist"
cd "$WORK"

# 1. Electron runtime for Windows (checksum verified)
ZIP="electron-v$ELECTRON_VERSION-win32-x64.zip"
if [ ! -f "$ZIP" ]; then
  curl -fsSL -o "$ZIP" "https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION/$ZIP"
fi
curl -fsSL "https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION/SHASUMS256.txt" \
  | grep " \*$ZIP\$" | sed 's/ \*/  /' | sha256sum -c -

# 2. go-winres (sets the icon / version info of the exe files)
if [ ! -x winres ]; then
  rm -rf gowinres ximage
  git clone -q --depth 1 https://github.com/tc-hib/go-winres gowinres
  git clone -q --depth 1 --branch v0.12.0 https://github.com/golang/image ximage
  (cd gowinres && go mod edit -replace golang.org/x/image=../ximage && GOFLAGS=-mod=mod GOPROXY=${GOPROXY:-direct} GOSUMDB=off go build -o ../winres .)
fi

# 3. App folder: Electron + our code, renamed and re-branded
rm -rf app && mkdir app && (cd app && unzip -q "../$ZIP")
mv app/electron.exe app/Crumby.exe
rm -f app/resources/default_app.asar app/LICENSES.chromium.html
find app/locales -name '*.pak' ! -name 'en-US.pak' ! -name 'pt-BR.pak' -delete
mkdir -p app/resources/app
cp -r "$ROOT"/{main.js,preload.js,desktop-helper.ps1,renderer} app/resources/app/
printf '{ "name": "crumby", "productName": "Crumby", "version": "1.3.1", "main": "main.js" }\n' > app/resources/app/package.json

mkdir -p res && cp "$ROOT/build/icon.ico" res/icon.ico
cat > res/winres.json <<'JSON'
{
  "RT_GROUP_ICON": { "#1": { "0409": "icon.ico" } },
  "RT_VERSION": { "#1": { "0409": {
    "fixed": { "file_version": "1.3.1.0", "product_version": "1.3.1.0" },
    "info": { "0409": {
      "CompanyName": "Crumby", "FileDescription": "Crumby - desktop cleaning robot", "FileVersion": "1.3.1",
      "InternalName": "Crumby.exe", "OriginalFilename": "Crumby.exe", "ProductName": "Crumby", "ProductVersion": "1.3.1" } } } } }
}
JSON
./winres patch --in res/winres.json --no-backup app/Crumby.exe

# 4. Single-file launcher with the app embedded
rm -f "$ROOT/launcher/payload.zip"
(cd app && zip -q -9 -r "$ROOT/launcher/payload.zip" .)
cp res/icon.ico "$ROOT/launcher/icon.ico"
(cd "$ROOT/launcher" && "$WORK/winres" simply --icon icon.ico --manifest gui --arch amd64 \
  --product-name Crumby --file-description "Crumby - desktop cleaning robot" \
  --product-version 1.3.1 --file-version 1.3.1 --original-filename Crumby.exe && rm icon.ico)
V=$(sha256sum "$ROOT/launcher/payload.zip" | cut -c1-12)
(cd "$ROOT/launcher" && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 GOFLAGS= \
  go build -trimpath -ldflags "-s -w -H=windowsgui -X main.version=1.3.1-$V" -o "$ROOT/dist/Crumby.exe" .)

echo "Built $ROOT/dist/Crumby.exe"
