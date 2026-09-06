# Third-party notices

Virtual Library depends on open-source packages declared in `package.json` and
resolved in `pnpm-lock.yaml`. Their original licenses continue to apply. Run
`pnpm licenses list --prod` against the locked dependency tree to inspect the
current package-license inventory.

The reviewed, path-free [dependency inventory](DEPENDENCY_LICENSES.json)
records each installed production dependency/version and its declared license,
including transitive build tools. Platform-specific esbuild and Rollup binaries
are grouped under their parent package families. `pnpm check:licenses` rejects
inventory drift and new license families; use `pnpm notices:update` after an
intentional dependency update and review the diff. This declaration inventory
does not replace the dependencies' own license texts and copyright notices.

The production site includes copies of the project license, asset notices,
this document, the dependency inventory, and the Basis Universal license.
Retain the source notices when redistributing a fork or compiled site.

## Basis Universal transcoder

`public/basis/basis_transcoder.js` and
`public/basis/basis_transcoder.wasm` are byte-for-byte copies of the Basis
Universal transcoder distributed with Three.js 0.182.0. Basis Universal is
maintained by Binomial LLC and licensed under the Apache License 2.0.

- Project: <https://github.com/BinomialLLC/basis_universal>
- Bundled copy: <https://github.com/mrdoob/three.js/tree/r182/examples/jsm/libs/basis>
- License: [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt)

Visual-asset provenance and attribution are recorded separately in
[`ASSET_LICENSES.md`](ASSET_LICENSES.md).
