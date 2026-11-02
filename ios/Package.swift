// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "ActivityPolicy", platforms: [.macOS(.v13)], products: [.library(name: "ActivityPolicy", targets: ["ActivityPolicy"])], targets: [
    .target(name: "ActivityPolicy", path: "Shared", exclude: ["LiveActivityAttributes.swift"]),
    .testTarget(name: "ActivityPolicyTests", dependencies: ["ActivityPolicy"], path: "ActivityPolicyTests")
])
