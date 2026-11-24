#![cfg(windows)]

use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Barrier};
use tauri_runtime::{Runtime, RuntimeHandle};
use tauri_runtime_wry::Wry;

// The old dispatcher cloned Tao's non-atomic Rc on worker threads. Exercise
// both concurrent clone/drop and the last handle outliving the UI runtime.
#[test]
fn runtime_handles_clone_on_workers_without_owning_the_event_loop() {
    let runtime = Wry::<()>::new_any_thread(Default::default()).unwrap();
    let handle = runtime.handle();
    let barrier = Arc::new(Barrier::new(9));
    let threads: Vec<_> = (0..8).map(|_| {
        let handle = handle.clone();
        let barrier = barrier.clone();
        std::thread::spawn(move || {
            barrier.wait();
            for _ in 0..100_000 {
                std::hint::black_box(handle.clone());
            }
        })
    }).collect();
    barrier.wait();
    for thread in threads {
        thread.join().unwrap();
    }

    // Monitor queries must be marshalled back to the owner thread, not read
    // through a leaked/cross-thread EventLoopWindowTarget.
    let finished = Arc::new(AtomicBool::new(false));
    let flag = finished.clone();
    let querying = handle.clone();
    let query = std::thread::spawn(move || {
        let _ = querying.primary_monitor();
        let _ = querying.monitor_from_point(0., 0.);
        let _ = querying.available_monitors();
        querying.display_handle().unwrap();
        flag.store(true, Ordering::Release);
    });
    let mut runtime = runtime;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
    while !finished.load(Ordering::Acquire) {
        assert!(std::time::Instant::now() < deadline, "main-thread query deadlocked");
        runtime.run_iteration(|_| {});
    }
    query.join().unwrap();
    drop(runtime);
    std::thread::spawn(move || {
        // A surviving handle must fail safely after event-loop shutdown.
        let _ = handle.run_on_main_thread(|| {});
        drop(handle);
    }).join().unwrap();
}
