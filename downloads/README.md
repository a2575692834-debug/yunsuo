# Desktop download files

Place the Windows portable build in the frontend public directory before the
Docker image is built:

```text
frontend/public/downloads/YunsuoDesktop-1.1.1.exe
```

The build output is normally generated at:

```text
desktop-lite/release/YunsuoDesktop-1.1.1.exe
```

The web app then serves it at `/downloads/YunsuoDesktop-1.1.1.exe`.

For a public GitHub deployment, upload the EXE to GitHub Releases and set
`DESKTOP_DOWNLOAD_URL` in `.env` to the release asset URL instead. Large EXE
files are intentionally excluded from Git.

## Standalone local installer

The independent, serverless local edition installer is available at:

```text
YunsuoLocal-Setup-1.0.0.exe
```

Build output:

```text
desktop-local/release/YunsuoLocal-Setup-1.0.0.exe
```

See `desktop-local/README.md` for local data, privacy and installation details.
