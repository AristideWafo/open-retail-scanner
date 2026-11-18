# Product scope

## Intended purpose

Open Retail Scanner helps an application capture and decode one visible retail barcode from a live camera stream on a supported device.

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

The project is application-independent. SafeEat is the first pilot integrator and supplies a bounded packaged-food use case. Additional integrators are welcome after the core benchmark and maintenance gates pass.

## Success definition

Success means clearly better than the current pilot reader on the locked replay corpus with no wrong-valid codes; commercial comparison is optional. The first integration must also improve end-to-end task completion in the SafeEat pilot. It does not mean parity on untested formats, devices, applications, or conditions.
