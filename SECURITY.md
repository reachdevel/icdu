# Security

`icdu` only reads file metadata (`lstat`, directory listings and, for files without allocated blocks, `stat(1)` flags). It never
opens or reads file contents and writes nothing. It has no runtime dependencies and makes no network requests.

If you find a vulnerability, please report it privately through GitHub's
[private vulnerability reporting](https://github.com/reachdevel/icdu/security/advisories/new) rather than a public issue.
