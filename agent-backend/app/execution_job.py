"""Owned process lifetime, including descendants after the shell has exited."""
import os


class ProcessTreeJob:
    def __init__(self):
        self.handle = None
        self.pid = None
        if os.name != 'nt':
            return
        import ctypes
        from ctypes import wintypes as w

        class Basic(ctypes.Structure):
            _fields_ = [('process_time', ctypes.c_int64), ('job_time', ctypes.c_int64),
                        ('flags', w.DWORD), ('min_working_set', ctypes.c_size_t),
                        ('max_working_set', ctypes.c_size_t), ('active_processes', w.DWORD),
                        ('affinity', ctypes.c_size_t), ('priority', w.DWORD), ('scheduling', w.DWORD)]

        class Io(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in ('reads', 'writes', 'other', 'read_bytes', 'write_bytes', 'other_bytes')]

        class Extended(ctypes.Structure):
            _fields_ = [('basic', Basic), ('io', Io), ('process_memory', ctypes.c_size_t),
                        ('job_memory', ctypes.c_size_t), ('peak_process', ctypes.c_size_t), ('peak_job', ctypes.c_size_t)]

        self.api = ctypes.WinDLL('kernel32', use_last_error=True)
        self.api.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
        self.api.CreateJobObjectW.restype = w.HANDLE
        self.api.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
        self.api.SetInformationJobObject.restype = w.BOOL
        self.api.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
        self.api.AssignProcessToJobObject.restype = w.BOOL
        self.api.CloseHandle.argtypes = [w.HANDLE]
        self.api.CloseHandle.restype = w.BOOL
        self.handle = self.api.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        limits = Extended()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; no breakaway.
        if not self.api.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            error = ctypes.WinError(ctypes.get_last_error())
            self.close()
            raise error

    @staticmethod
    def creation_flags():
        # Assign before user code runs, so a fast spawning shell cannot race us.
        return 0x4 if os.name == 'nt' else 0  # CREATE_SUSPENDED

    def attach_and_resume(self, process):
        self.pid = process.pid
        if os.name != 'nt':
            return
        import ctypes
        from ctypes import wintypes as w
        if not self.api.AssignProcessToJobObject(self.handle, w.HANDLE(int(process._handle))):
            raise ctypes.WinError(ctypes.get_last_error())

        class ThreadEntry(ctypes.Structure):
            _fields_ = [('size', w.DWORD), ('usage', w.DWORD), ('thread', w.DWORD),
                        ('owner', w.DWORD), ('priority', w.LONG), ('delta', w.LONG), ('flags', w.DWORD)]

        self.api.CreateToolhelp32Snapshot.argtypes = [w.DWORD, w.DWORD]
        self.api.CreateToolhelp32Snapshot.restype = w.HANDLE
        self.api.Thread32First.argtypes = [w.HANDLE, ctypes.POINTER(ThreadEntry)]
        self.api.Thread32First.restype = w.BOOL
        self.api.Thread32Next.argtypes = [w.HANDLE, ctypes.POINTER(ThreadEntry)]
        self.api.Thread32Next.restype = w.BOOL
        self.api.OpenThread.argtypes = [w.DWORD, w.BOOL, w.DWORD]
        self.api.OpenThread.restype = w.HANDLE
        self.api.ResumeThread.argtypes = [w.HANDLE]
        self.api.ResumeThread.restype = w.DWORD
        snapshot = self.api.CreateToolhelp32Snapshot(4, 0)
        if snapshot in (None, ctypes.c_void_p(-1).value):
            raise ctypes.WinError(ctypes.get_last_error())
        resumed = False
        try:
            entry = ThreadEntry()
            entry.size = ctypes.sizeof(entry)
            more = self.api.Thread32First(snapshot, ctypes.byref(entry))
            while more:
                if entry.owner == process.pid:
                    thread = self.api.OpenThread(2, False, entry.thread)
                    if not thread:
                        raise ctypes.WinError(ctypes.get_last_error())
                    try:
                        if self.api.ResumeThread(thread) == 0xFFFFFFFF:
                            raise ctypes.WinError(ctypes.get_last_error())
                        resumed = True
                    finally:
                        self.api.CloseHandle(thread)
                more = self.api.Thread32Next(snapshot, ctypes.byref(entry))
        finally:
            self.api.CloseHandle(snapshot)
        if not resumed:
            raise OSError('无法恢复已归属的命令进程')

    def close(self):
        if os.name == 'nt':
            if self.handle:
                self.api.CloseHandle(self.handle)
                self.handle = None
        elif self.pid:
            import signal
            try:
                os.killpg(self.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            self.pid = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
