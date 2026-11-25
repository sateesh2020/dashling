// Prints the next events (now -> end of tomorrow): start|end|allday|calendar|title. Needs Calendar access (macOS asks once).
import EventKit
import Foundation
let store = EKEventStore(); let sem = DispatchSemaphore(value: 0); var ok = false
store.requestFullAccessToEvents { g, _ in ok = g; sem.signal() }
_ = sem.wait(timeout: .now() + 20)
guard ok else { print("cal_denied=1"); print("cal_status=\(EKEventStore.authorizationStatus(for: .event).rawValue)"); exit(0) }
let now = Date(), end = Calendar.current.date(byAdding: .day, value: 2, to: Calendar.current.startOfDay(for: now))!
let evs = store.events(matching: store.predicateForEvents(withStart: now, end: end, calendars: nil)).sorted { $0.startDate < $1.startDate }.prefix(8)
for e in evs { print("ev=\(Int(e.startDate.timeIntervalSince1970))|\(Int(e.endDate.timeIntervalSince1970))|\(e.isAllDay ? 1 : 0)|\((e.calendar.title).replacingOccurrences(of: "|", with: "/"))|\((e.title ?? "").replacingOccurrences(of: "|", with: "/").replacingOccurrences(of: "\n", with: " "))") }
if evs.isEmpty { print("cal_empty=1") }
