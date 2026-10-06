// Windows 10+: keep Bubble and its SQLite extension in one process lifetime.
// Rebuild: zig cc scripts/windows_launcher.c -target x86_64-windows-gnu -Os -s -municode "-Wl,--subsystem,windows" -luser32 -o bin/bubble-launcher.exe
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif
#include <windows.h>
#include <wchar.h>
#include <stdio.h>

static int fail(const wchar_t *action) {
    DWORD error = GetLastError();
    wchar_t message[256];
    swprintf(message, 256, L"Could not %ls.\nWindows error: %lu", action, error);
    MessageBoxW(NULL, message, L"Bubble", MB_OK | MB_ICONERROR);
    // Returning from the launcher closes its handles, including the job.
    return 1;
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous, PWSTR args, int show) {
    wchar_t directory[32768];
    DWORD length = GetModuleFileNameW(NULL, directory, 32768);
    if (!length || length >= 32768) return fail(L"locate Bubble");
    wchar_t *filename = wcsrchr(directory, L'\\');
    if (!filename) {
        SetLastError(ERROR_BAD_PATHNAME);
        return fail(L"locate Bubble's directory");
    }
    *filename = L'\0';

    // The runtime lives in bin; --path keeps resources and SQLite rooted at the bundle.
    wchar_t runtime[32768];
    if (swprintf(runtime, 32768, L"%ls\\bin\\bubble-runtime.exe", directory) < 0) {
        SetLastError(ERROR_BUFFER_OVERFLOW);
        return fail(L"build the runtime path");
    }
    wchar_t command[32768];
    if (swprintf(command, 32768, L"\"%ls\" \"--path=%ls\" %ls", runtime, directory, args) < 0) {
        SetLastError(ERROR_BUFFER_OVERFLOW);
        return fail(L"forward launch arguments");
    }

    HANDLE job = CreateJobObjectW(NULL, NULL);
    if (!job) return fail(L"create the process job");
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits)))
        return fail(L"set process cleanup");

    // Assign the job during creation: Bubble cannot spawn an unprotected child.
    SIZE_T size = 0;
    InitializeProcThreadAttributeList(NULL, 1, 0, &size);
    STARTUPINFOEXW startup = {0};
    startup.StartupInfo.cb = sizeof(startup);
    startup.lpAttributeList = HeapAlloc(GetProcessHeap(), 0, size);
    if (!startup.lpAttributeList) {
        SetLastError(ERROR_NOT_ENOUGH_MEMORY);
        return fail(L"allocate launch settings");
    }
    if (!InitializeProcThreadAttributeList(startup.lpAttributeList, 1, 0, &size))
        return fail(L"prepare launch settings");
    if (!UpdateProcThreadAttribute(startup.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST,
                                  &job, sizeof(job), NULL, NULL))
        return fail(L"attach the process job");

    PROCESS_INFORMATION process = {0};
    // No inherited job handle: only this launcher owns it. Children inherit membership.
    if (!CreateProcessW(runtime, command, NULL, NULL, FALSE, EXTENDED_STARTUPINFO_PRESENT,
                        NULL, directory, &startup.StartupInfo, &process))
        return fail(L"start Bubble");
    DeleteProcThreadAttributeList(startup.lpAttributeList);
    HeapFree(GetProcessHeap(), 0, startup.lpAttributeList);
    CloseHandle(process.hThread);

    if (WaitForSingleObject(process.hProcess, INFINITE) != WAIT_OBJECT_0)
        return fail(L"wait for Bubble to exit");
    DWORD code = 1;
    GetExitCodeProcess(process.hProcess, &code);
    CloseHandle(process.hProcess);
    // Bubble exited or was killed. Closing the job kills any remaining SQLite process.
    CloseHandle(job);
    return (int)code;
}
