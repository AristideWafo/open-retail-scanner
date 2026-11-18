# Clean-room and comparative-testing policy

## Purpose

Protect independent implementation and respect third-party licences while allowing lawful black-box evaluation.

## Prohibited activities

Contributors must not:

- decompile, disassemble, translate, instrument, patch, inspect internal assets, or reverse engineer a proprietary scanner;
- derive source, algorithms, weights, constants, private APIs, or implementation details from proprietary binaries;
- copy proprietary UI, documentation, sample code, error strings, or non-public test material;
- use a commercial scanner's output to train or label a model without explicit permission;
- bypass licensing, domain restrictions, usage controls, or technical protections.

## Permitted baseline work

Subject to licence and legal review, a designated evaluator may operate a commercial product through its documented public API as a black box and record aggregate outcomes such as detection success, latency, resource use, and error category.

The implementation team receives the preregistered protocol and aggregate comparison, not proprietary assets or investigative notes.

## Publication gate

No named comparative claim may be published until a qualified human reviewer confirms:

1. the applicable licence permits the test and proposed disclosure;
2. the protocol is fair, reproducible, and versioned;
3. limitations and funding are disclosed;
4. the comparison does not imply universal superiority.

Scanbot's evaluation agreement and current terms must be reviewed at the time of testing. This document is an engineering policy, not legal advice.
