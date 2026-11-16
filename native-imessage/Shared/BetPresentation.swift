import Foundation

enum ConfidenceInput {
    static let range = 1.0...100.0

    static func normalized(_ controlValue: Double) -> Double { controlValue / 100 }

    static func controlValue(for normalized: Double) -> Double { min(100, max(1, normalized * 100)) }

    static func displayValue(for normalized: Double) -> Int { Int((normalized * 100).rounded()) }
}

extension PickReceipt {
    func matches(option: Int?, confidence: Double?) -> Bool {
        saved && self.option == option && self.confidence == confidence && updatedAt.isFinite
    }
}

enum RevealSchedule {
    static func nextDefault(in timezoneID: String, after now: Date = Date(),
                            calendar: Calendar = Calendar(identifier: .gregorian)) -> Date? {
        guard let timezone = TimeZone(identifier: timezoneID) else { return nil }
        var calendar = calendar
        calendar.timeZone = timezone
        return calendar.nextDate(after: now, matching: DateComponents(hour: 20, minute: 0), matchingPolicy: .nextTime)
    }
}
