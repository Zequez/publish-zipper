# Publish Zipper

A small self-hosted service for publishing websites from ZIP archives.

Publish Zipper receives a website ZIP, validates its `CNAME` against the domains authorized for the client key, extracts the site, and deploys it using a configurable publishing strategy.

Version: **0.1.0** — proof of concept.

## How it works

1. A client uploads a website ZIP and provides a client key.
2. Publish Zipper checks the key and determines which domains it can publish to.
3. It reads the ZIP's root `CNAME` and verifies that the domain is authorized.
4. The uploaded archive and deployment files are stored under `uploads/`.
5. The configured publishing strategy deploys the site.

The initial publishing strategy uses GitHub Pages, pushing the extracted website to a configured GitHub repository and branch over SSH.

## Requirements

- [Bun](https://bun.sh/)
- Git
- A GitHub repository configured for publishing
- An SSH deploy key with write access to the target repository

## Setup

Install dependencies:

```sh
bun install
```

Configure `routing.yaml` with the domains, client keys, repositories, branches, and publishing strategies you intend to use.

Example:

```yaml
blog.webjam.space:
  strategy: gh-pages
  deployKey: github-web-jam-blog
  clientKey: ezequiel-key
  repository: zequez/blog
  branch: gh-pages
```

Create a deploy key:

```sh
bun run create-deploy-key github-web-jam-blog
```

This creates a private key and its corresponding `.pub` file in `deploy-keys/`.

Add the public key to the target GitHub repository under **Settings → Deploy keys**, enabling **Allow write access**.

The private key must remain on the server and must not be committed to version control.

Configure the client key in `client-keys/` according to the filename expected by your routing configuration.

## Running

Start the server:

```sh
bun run start
```

For development:

```sh
bun run dev
```

The server listens on port `2233` by default.

Open [http://localhost:2233](http://localhost:2233) to access the upload form.

## Upload requirements

The uploaded file must be a ZIP archive containing a `CNAME` file at its root.

For example:

```text
website.zip
├── CNAME
├── index.html
├── styles.css
└── assets/
    └── image.png
```

The `CNAME` file must contain a domain authorized for the supplied client key.

Publish Zipper uses that domain to select the routing configuration and deployment strategy.

## Storage layout

Uploads are organized by domain and timestamp:

```text
uploads/
└── blog.webjam.space/
    └── 2026-10-25T12:00:00.000Z/
        ├── www.zip
        ├── status.json
        └── www/
            ├── CNAME
            ├── index.html
            └── ...
```

`www.zip` preserves the uploaded archive, `www/` contains the extracted website, and `status.json` is reserved for deployment status information.

## Publishing strategies

Strategies live in `publish-strategies/`. Each strategy implements the publishing behavior for its target platform.

The initial strategy is `gh-pages`, which pushes the extracted website to the configured GitHub repository and branch.

## Security and limitations

Publish Zipper 0.1.0 is an early proof of concept, not a hardened public upload service.

Before exposing it to untrusted users or the public internet, review at least:

- Authentication and client-key storage.
- ZIP extraction safety and path traversal handling.
- Upload size limits and resource exhaustion.
- Filesystem permissions and secret management.
- SSH host verification and deployment permissions.
- Error handling, status reporting, and temporary-file cleanup.

Use dedicated repositories or branches for deployment, since publishing may replace the target branch's history.

## License

AGPL-3.0