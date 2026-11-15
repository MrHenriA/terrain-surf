# Security scope

Terrain Surf is a static browser application with no login, backend, database, API keys, remote code execution service or public uploads. Its notebook is held in the current page and exported as JSON at the user's request. A local-storage flag remembers the tutorial; do not enter sensitive personal information in notebook text.

The release review uses [OWASP ASVS 5.0](https://asvs.owasp.org/), the [OWASP HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html) and the [OWASP CSP Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html) as scoped guidance. It is not an OWASP certification or a complete ASVS conformance assessment.

Controls in this package:

- A selected-file release excludes credentials, local logs, transcripts, original asset projects and private workstation paths.
- Scripts and browser dependencies are local and pinned. The content security policy restricts scripts to this origin and the exact inline import-map hash; it permits neither script `unsafe-inline` nor `unsafe-eval`.
- Notebook text is assigned as text/textarea values and serialized to JSON. It is not rendered as executable HTML. DOM/URL input paths and actual export behavior are reviewed and tested.
- External source links do not receive a referrer. Scientific product URLs and original third-party license notices are retained.
- Styling allows inline styles because the guided interface and animation libraries set element styles. This exception does not allow inline scripts.

The policy is delivered by HTML metadata because GitHub Pages does not support arbitrary response-header configuration in a repository. Meta CSP cannot enforce `frame-ancestors`; do not mistake a repository `_headers` file for a GitHub Pages response control. Framing protection and any extra response headers need hosting support if required later.

HTTPS, DNS ownership, custom-domain configuration and public accessibility must be checked after deployment. No local test proves a public certificate or a signed-out visitor can access the site. Dependency advisory checks are point-in-time evidence, not a guarantee against future or unpublished vulnerabilities. Repository changes and dependency updates should repeat the static-content and browser checks.

Report suspected issues privately to the repository owner through the project's GitHub profile; do not put credentials or personal notes in a public issue.
