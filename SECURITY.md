# Security Policy

Thank you for helping keep **Avenx.js** secure.

We take security seriously and appreciate responsible disclosure of potential vulnerabilities. If you discover a security issue, please report it privately so we can investigate and resolve it before public disclosure.

---

## Supported Versions

The following table indicates which versions of Avenx.js currently receive security updates.

| Version                 |   Supported    |
| ----------------------- | :------------: |
| Latest stable release   |       ✅       |
| Previous stable release |       ✅       |
| Development (`main`)    | ⚠️ Best effort |
| Older releases          |       ❌       |

Only the latest stable releases are guaranteed to receive security fixes.

---

## Reporting a Vulnerability

**Please do not create a public GitHub issue for security vulnerabilities.**

Instead, report vulnerabilities through:

- **GitHub Security Advisories (preferred):** Use GitHub's private vulnerability reporting feature.

Please include as much information as possible:

- A clear description of the vulnerability
- Steps to reproduce the issue
- A proof of concept (if applicable)
- The affected version(s)
- Any suggested mitigation or fix

The more information you provide, the faster we can investigate.

---

## What to Expect

After receiving your report, we aim to:

- Acknowledge receipt within **48 hours**
- Begin investigating the issue promptly
- Keep you informed about our progress
- Release a fix as soon as reasonably possible
- Publicly credit you for the discovery (if you would like to be credited)

Response times may vary depending on the complexity and severity of the issue.

---

## Responsible Disclosure

We kindly ask that you:

- Give us reasonable time to investigate and fix the issue before public disclosure.
- Avoid accessing, modifying, or deleting data that does not belong to you.
- Avoid disrupting services or negatively impacting other users.
- Conduct testing only in a safe and responsible manner.

We value responsible security research and appreciate your cooperation.

---

## Scope

This policy applies to all official Avenx.js repositories and packages maintained by the Avenx.js team, including:

- Core framework
- Compiler
- Runtime
- Router
- CLI

---

## Security Best Practices

When using Avenx.js, we recommend:

- Keeping your dependencies up to date.
- Regularly updating to the latest Avenx.js release.
- Avoiding untrusted third-party plugins.
- Never exposing secrets or API keys in client-side code.
- Following general web security best practices (e.g. Content Security Policy, input validation, output escaping, HTTPS).

### Content Security Policy

A production build needs no `script-src 'unsafe-eval'`. Every template
expression, directive binding, list key, inline event handler and `<action>`
body is compiled to a real JavaScript function at build time, so nothing in the
bundle evaluates source at run time.

A development build (`avenx build --dev`, `avenx serve`) does carry the
expression interpreter, so that a template being edited keeps rendering — and it
therefore needs `'unsafe-eval'`. It is not meant to be deployed. Where a
development build has to run under the production policy, build with
`--csp-strict` (or set `"csp": { "strict": true }`), which leaves the
interpreter out and then parses the emitted bundle and refuses it if it still
contains `eval`, the `Function` constructor or a `with` statement.

Component stylesheets are mounted as `<style>` elements the runtime creates, so
an Avenx page needs `style-src 'self' 'unsafe-inline'` in every mode, unless
you supply a per-response nonce via
`Avenx.styleMountManager.setCspNonce(nonce)`.

Every build prints the directives its output can run under. The [deployment
guide](https://avenx-js.com/guides/deployment#content-security-policy-csp) has
the per-mode table.

---

## Hall of Thanks

We appreciate security researchers who help improve Avenx.js.

Contributors who responsibly disclose valid vulnerabilities may be acknowledged in our release notes or security advisories, unless they prefer to remain anonymous.

Thank you for helping make Avenx.js safer for everyone.
