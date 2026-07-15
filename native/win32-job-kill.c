#include <windows.h>
#include <stdlib.h>
int main(int argc, char **argv) {
    if (argc != 2) return 1;
    DWORD pid = (DWORD)strtoul(argv[1], NULL, 10);
    if (pid <= 1) return 1;
    HANDLE h = OpenProcess(PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_QUOTA, FALSE, pid);
    if (!h) return GetLastError() == ERROR_INVALID_PARAMETER ? 2 : 1; /* 2: already gone */
    HANDLE job = CreateJobObjectW(NULL, NULL);
    if (!job) { CloseHandle(h); return 1; }
    /* If the target is already in a job we cannot join, fall back to TerminateProcess tree-root. */
    if (!AssignProcessToJobObject(job, h)) {
        BOOL inJob = FALSE; IsProcessInJob(h, NULL, &inJob);
        if (!inJob) { CloseHandle(job); CloseHandle(h); return 1; }
    }
    BOOL ok = TerminateJobObject(job, 137);
    if (!ok) ok = TerminateProcess(h, 137);
    CloseHandle(job); CloseHandle(h);
    return ok ? 0 : 1;
}
