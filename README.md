# QC Scan

Windows desktop app for quality control with a barcode scanner. Scan a product code, scan a serial number, scan defect codes by area, scan a location, and scan commands (SAVE, BACK, REDO, UNDO).

## Install
Download `QC-Scan-Setup-x.y.z.exe` from [Releases](https://github.com/mrdivein/eyeglass-qc-apps/releases/latest) and run it. On first start, open Settings and enter the data URL, the data key and the operator name.

## Updates
The app checks for a new version at start and every 4 hours, downloads it in the background and shows a "Restart now" bar when it is ready. For a private repository, enter a read-only fine-grained token (Contents: read) in Settings. Leave it empty for a public repository. Local data is kept in `%APPDATA%\QC Scan` and is not removed by updates or uninstall.

## Release
1. Change `version` in `package.json`.
2. Merge to `main`. GitHub Actions runs the tests, builds the Windows installer and publishes the release.

## Data
Lots, products, locations, the defect list and the export column layout come from the data URL, a read-only endpoint protected by a key. None of that configuration is stored in this repository. QC results are stored locally in `%APPDATA%\QC Scan\records.jsonl`. The Saved page can copy rows for a spreadsheet or save a CSV file.

## Barcodes
Code 128, uppercase letters, digits and `-` only: `QCS-D-<AREA>-<DEFECT>`, `QCS-C-<COMMAND>`, `QCS-L-<LOCATION>`. Print them, or save them as PDF, from the Code sheets page.

## Development
```
npm install
npm test
npm start
```
