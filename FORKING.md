# Forking and independent maintenance

Virtual Library is published for self-directed forks and independent modification. This repository does not provide individual support, accept feature requests or pull requests, or operate public issue and discussion forums.

When maintaining a fork, keep shared application changes content-neutral. Do not commit copyrighted books, personal catalogue data, private network addresses, credentials, deployment secrets, or machine-specific paths.

Before distributing a change:

1. install with `pnpm install --frozen-lockfile`;
2. run `pnpm verify` for release, privacy, dependency notice, LFS, test, build, and performance checks;
3. run `pnpm audit --audit-level high`;
4. verify both an empty `books/` directory and a neutral fixture;
5. run `pnpm check:history` with complete history and the LFS objects for every ref intended for publication;
6. review screenshots, commit metadata, and the final staged content manually.

See [Release review](docs/release-readiness.md) for the snapshot workflow. A clean working tree does not establish that older commits or LFS payloads are safe to publish.

Keep collection-specific providers and deployments in downstream repositories so world, control, reader, and ingestion fixes remain portable.
