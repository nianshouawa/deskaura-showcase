# DeskAura Windows Distribution

## Package

Run `npm.cmd run tauri:build` from `companion-frontend`.
The NSIS installer is generated under `src-tauri/target/release/bundle/nsis`.
Share the installer, not the standalone application executable.

## Included

- Desktop UI and the three packaged backend services.
- Local embedding and speech-recognition models, with their license files.
- Existing motion library and application icons.
- Chinese/English installer, current-user installation and uninstaller.
- WebView2 detection and bootstrapper download when missing (internet required).

## Not Included

- API keys, credentials, saved roles, imported character models.
- Conversations, memories, microphone/camera permissions.
- The developer's MCP configuration, Node.js or Python installations.
- Project-local MCP packages and browser profiles.

New users import their own authorized character model and configure their own
API services. MCP is optional and initially empty. Local operations start with
read-only access; command execution requires explicit user configuration.
PowerShell uses the installed Windows shell. Python/JavaScript and stdio MCP
services require their respective runtimes/packages installed by the recipient;
commands are resolved from PATH or an explicitly configured executable path.
No interpreter is downloaded automatically.

Persona templates default to no preset; saved character settings are retained.
Module and local-operation controls synchronize immediately without automatic
retesting. Displayed module results describe the last explicit check, not a
continuous guarantee of connectivity.

## Storage

Installed builds use the current user's LocalAppData/com.deskaura.app directory.
Source-tree builds keep the existing sibling DeskAura-Data directory.
User data is not an installer resource. Back up personal data before upgrading
or uninstalling. Do not delete WebView IndexedDB: it may contain imported models.

## Limits And Release Checks

- Target: Windows x64. WebView2 and camera/microphone Windows permissions apply.
- Backend ports 8000, 8001 and 8002 must be free.
- Blender/Maya conversion requires separately installed licensed software.
- Cloud services need the recipient's own account, credentials and quota.
- The package is unsigned; Windows may show an unknown-publisher warning.
  Production distribution should use a publisher-owned signing certificate.
- Redistributing models, generated motion assets and third-party dependencies
  remains subject to their respective licenses and provider terms.
- Test on a clean Windows machine before broad/public release; local packaging
  checks alone do not prove compatibility with every recipient's machine.
