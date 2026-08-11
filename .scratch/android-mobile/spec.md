# Android mobile client

Status: ready-for-agent

## Goal

Ship an Android-first native AllChat Member client in this repository. The app uses bare React Native for shared TypeScript UI and state, with Kotlin adapters for Android lifecycle, secure storage, notifications, Telecom, foreground media, and screen capture.

The first public release supports multiple Instances, native Member-level feature parity, cached read-only history, encrypted background push, Voice Rooms, Direct Calls, soundboard, and viewing and broadcasting screen shares. Community Owner configuration remains in the web client.

## Decisions

- Keep one Git repository without a monorepo framework. Go remains at the repository root and the standalone React Native project lives in `mobile/`.
- Use one `vX.Y.Z` version across the Instance, bots, push relay, bootstrapper, and Android application initially.
- Target Android API 36 and support API 26 and newer.
- Require valid HTTPS/WSS certificates in production builds.
- Store every Instance's bearer Session and encryption material in Android Keystore and namespace cached data by Instance.
- Offline mode is cached and read-only; no send outbox is included.
- Keep the Instance self-contained. The project-operated encrypted push relay is optional and must be enabled by the Community Owner.
- Treat local media state as authoritative for microphone ownership. Stale backend state must never activate or retain local capture.
- Publish signed APKs through GitHub Releases and AABs to a Google Play internal track for manual promotion.

## Acceptance

- An Android Member can add and switch between multiple Instances without sharing credentials or cached state between them.
- Browser cookie Sessions and native bearer Sessions work concurrently and can be revoked through the existing Session model.
- Realtime state resumes by cursor, falls back to a snapshot when required, and remains independent from notification delivery.
- Native messaging, Member, moderation, notification, Voice Room, Direct Call, soundboard, and screen-sharing flows match the permissions and behavior of the web client.
- Background notifications contain encrypted payloads that the relay cannot read.
- Active audio survives backgrounding and screen lock through an explicit foreground call service.
- Every local leave, logout, Instance switch, fatal authentication error, or media-controller shutdown stops microphone capture immediately.
- Release CI verifies Go, TypeScript, Android, protocol, push, media-resilience, and privacy tests before producing signed artifacts.

## Comments
