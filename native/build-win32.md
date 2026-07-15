# Windows process-tree helper

The helper binary at `bin/win32-job-kill-x64.exe` is committed from Windows CI.

Current committed binary:

- Source CI run: https://github.com/Pythoughts-labs/claude-architect/actions/runs/29451055892 (windows-latest, MSVC `cl /O2 /W4`)
- SHA-256: `a96636f4d9e564b978172662e005e2a521205dd3b2eaea271b511854a05ccd10`

Build with MSVC from the `native` directory:

```text
cl /O2 /W4 win32-job-kill.c /Fe:bin\win32-job-kill-x64.exe
```

Or cross-compile with MinGW:

```text
x86_64-w64-mingw32-gcc -O2 -o bin/win32-job-kill-x64.exe win32-job-kill.c
```

In addition to terminating a process tree with `<pid>`, the helper accepts
`token <pid>` and prints that process's creation FILETIME as a decimal value.

On every rebuild, record the SHA-256 of the committed binary in this file.
