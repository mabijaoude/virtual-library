# Security and private content

Virtual Library is provided for independent maintenance. There is no dedicated upstream security response service or response-time commitment. A fork that accepts reports should publish its own private security contact and supported-version policy.

If you find a vulnerability, avoid posting credentials, private documents, browser-storage dumps, or exploit details to public issues. Contact the operator of the affected deployment through an established private channel. For a dependency vulnerability, use that dependency's documented security reporting process.

## Before distributing a fork

- Run `pnpm verify` and `pnpm audit --audit-level high` with the lockfile installed.
- Review the exact release tree, all refs you intend to publish, commit metadata, and Git LFS payloads. `pnpm check:history` requires complete history and locally available payloads.
- Keep personal collections and environment files out of Git. Everything in a shared static collection is downloadable by anyone with site access.
- Retain Markdown sanitization and the server's security headers. Review external images and links in untrusted content.
- Use HTTPS and maintain your host, reverse proxy, and dependencies independently.

The privacy scanner detects common path and credential patterns in raw bytes, including ordinary binary metadata and UTF-16 paths. It is not a comprehensive secret scanner, cannot interpret every compressed asset format, and cannot detect private information visible only in image pixels. Screenshots and provenance need human review too.
