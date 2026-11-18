# Product scope

## Intended purpose

SafeEat Scanner SDK helps an application capture and decode one visible retail barcode from a live camera stream on a supported device.

Initial supported symbologies:

- EAN-8
- EAN-13
- UPC-A

Initial surface: modern mobile web browsers in the benchmarked support matrix.

## Explicit exclusions

The SDK does not:

- identify ingredients, allergens, nutrition, contamination, or product suitability;
- verify that a database record matches the physical package;
- guarantee that a product is safe, compatible, authentic, or current;
- replace manual entry or inspection of the physical label;
- upload frames or provide a cloud-scanning service;
- initially support QR, Data Matrix, PDF417, OCR, batch scanning, or inventory workflows.

## Users

The first consumer is SafeEat. General third-party SDK support is conditional on evidence of external demand and a funded maintenance owner.

## Success definition

Success means non-inferiority to the selected commercial baseline on the locked SafeEat EAN/UPC benchmark and an improvement in end-to-end SafeEat task completion. It does not mean parity on untested formats, devices, or conditions.
