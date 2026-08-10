# Embed the TURN relay

AllChat will embed Pion TURN in the Instance so calls and screen sharing work from networks that cannot reach the SFU directly. Dependable connectivity is worth the additional bandwidth cost, public ports, and attack surface: deployments will use a bounded UDP relay range, short-lived per-Member credentials, allocation quotas, rate limits, and destination restrictions, while operators may disable the built-in Relay when using an external TURN service.
