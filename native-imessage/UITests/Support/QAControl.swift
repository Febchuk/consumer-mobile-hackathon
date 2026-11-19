import Foundation
import XCTest

/// Talks to the test-control server the harness runs on loopback beside the backend. It seeds synthetic fixtures, moves
/// fixture bets through time, lets the other fixture people act through the real public handlers, and reads state back.
/// The app under test never sees this server or its token.
struct QAControl {
    struct Failure: Error, CustomStringConvertible {
        let description: String
    }

    private let endpoint: URL
    private let token: String
    /// The test now running, sent with every call so a retry the harness makes on its behalf is recorded against it.
    static var currentTest = ""

    init(environment: [String: String] = ProcessInfo.processInfo.environment) throws {
        guard let raw = environment["CALLED_IT_QA_CONTROL_URL"], let url = URL(string: raw), url.scheme == "http", url.host == "127.0.0.1",
              let token = environment["CALLED_IT_QA_CONTROL_TOKEN"], token.count == 64 else {
            throw Failure(description: "[NATIVE-QA-CONTROL] BLOCKED: run through tests/native-sim/run.mjs, which supplies the loopback control endpoint")
        }
        endpoint = url
        self.token = token
    }

    @discardableResult
    func call(_ operation: String, _ arguments: [String: Any] = [:]) throws -> Any {
        var body = arguments
        body["op"] = operation
        if body["test"] == nil { body["test"] = Self.currentTest }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let done = DispatchSemaphore(value: 0)
        var outcome: Result<Data, Error> = .failure(Failure(description: "no reply"))
        let session = URLSession(configuration: .ephemeral)
        session.dataTask(with: request) { data, _, error in
            outcome = data.map { .success($0) } ?? .failure(error ?? Failure(description: "no reply"))
            done.signal()
        }.resume()
        guard done.wait(timeout: .now() + 35) == .success else { throw Failure(description: "[NATIVE-QA-CONTROL] \(operation) timed out") }
        let data = try outcome.get()
        guard let reply = try JSONSerialization.jsonObject(with: data) as? [String: Any], reply["ok"] as? Bool == true, let result = reply["result"] else {
            throw Failure(description: "[NATIVE-QA-CONTROL] \(operation) failed: " + (String(data: data, encoding: .utf8) ?? "unreadable reply"))
        }
        return result
    }

    /// A fresh database with the four fixture people, groups G1 (Cora, Sage, Finn) and G2 (Cora, Finn, Oli), no turn and no bets.
    func reset(points: [String: [String: Int]] = [:]) throws {
        try call("reset", points.isEmpty ? [:] : ["points": points])
    }

    func seedTurn(group: String, creator: String, subject: String) throws {
        try call("seedTurn", ["group": group, "creator": creator, "subject": subject])
    }

    func seedBet(_ key: String, group: String = "G1", creator: String = "cora", subject: String = "sage", format: String = "yes_no", question: String? = nil) throws {
        var arguments: [String: Any] = ["key": key, "group": group, "creator": creator, "subject": subject, "format": format]
        if let question { arguments["question"] = question }
        try call("seedBet", arguments)
    }

    /// Moves one fixture bet through time ("revealed", "challengeOver", "answerTimeout") and runs the product's sweep.
    func shiftBet(_ key: String, to state: String) throws {
        try call("shiftBet", ["key": key, "to": state])
    }

    func runJob(_ job: String) throws {
        try call("runJob", ["job": job])
    }

    /// Another fixture person calls a real public function. Returns the error code, or nil when the call succeeded.
    @discardableResult
    func act(_ actor: String, _ kind: String, _ path: String, _ arguments: [String: Any] = [:], remember: String? = nil) throws -> String? {
        var body: [String: Any] = ["actor": actor, "kind": kind, "path": path, "args": arguments]
        if let remember { body["remember"] = remember }
        let reply = try call("act", body) as? [String: Any]
        return reply?["ok"] as? Bool == true ? nil : reply?["code"] as? String ?? "UNKNOWN"
    }

    func inspect() throws -> [String: Any] {
        guard let state = try call("inspect") as? [String: Any] else { throw Failure(description: "[NATIVE-QA-CONTROL] unreadable state") }
        return state
    }

    func rows(_ table: String) throws -> [[String: Any]] {
        try inspect()[table] as? [[String: Any]] ?? []
    }

    /// Writes a retry or a measurement into the run's evidence. Never pass private text here.
    func note(test: String, kind: String, detail: String) throws {
        try call("note", ["test": test, "kind": kind, "detail": detail])
    }

    /// The app's next `count` calls to one public function fail with a server error that carries no code, as an overloaded
    /// server's would. They never reach the backend.
    func failNext(_ path: String, count: Int) throws {
        try call("failNext", ["path": path, "count": count])
    }

    /// The public functions the app has called since the last reset, in order, without their arguments.
    func calls() throws -> [[String: Any]] {
        try call("calls") as? [[String: Any]] ?? []
    }
}
