# Testing the GitHub release flow before publishing

## Recommendation

Use the real release workflow as a two-phase pipeline:

1. Build, package, upload, download, and validate every platform artifact.
2. Publish only behind an explicit gate.

Add `workflow_dispatch` with a typed Boolean such as `publish`, defaulting to `false`. A maintainer can then push a feature branch and manually run the real workflow against that branch. The UI has a branch selector, and the CLI equivalent is `gh workflow run release.yml --ref <branch> -f publish=false`. Manual workflows support typed inputs, and Boolean values remain Booleans in the `inputs` context. The dispatch-capable workflow file must already exist on the default branch before GitHub will accept manual dispatches. [Defining manual inputs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#defining-inputs-for-manually-triggered-workflows), [manually running a workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)

This cannot test unpushed local commits: GitHub needs a repository ref. The safe rehearsal unit is therefore a pushed branch, before creating or pushing a release tag.

Conceptually:

```yaml
on:
  push:
    tags: ['v[0-9]+.[0-9]+.[0-9]+']
  workflow_dispatch:
    inputs:
      publish:
        type: boolean
        default: false
        description: Publish the validated artifacts
      version:
        type: string
        required: true
        description: Version used to name rehearsal artifacts

jobs:
  # Existing test/build/package matrix runs for both triggers.

  validate-artifacts:
    needs: [linux-binaries, bootstrapper, android-apk, desktop]
    # Download everything and fail unless the expected release set is complete.

  publish:
    needs: validate-artifacts
    if: >-
      github.event_name == 'push' &&
      startsWith(github.ref, 'refs/tags/v')
    environment: production
    permissions:
      contents: write
```

The exact condition is a policy choice. The safest model keeps manual runs permanently non-publishing and only publishes version-tag runs. If manual publishing is required, additionally require `inputs.publish == true`, restrict the selected ref, and retain the protected `production` environment.

## Why a pull request check is not enough

A `pull_request` run normally checks out GitHub's synthetic merge ref (`refs/pull/<number>/merge`), so it verifies how the change combines with the target branch rather than necessarily the branch head. The head can be selected explicitly with `github.event.pull_request.head.sha`, but that still does not reproduce a tag-triggered release context. [Pull request event and merge-ref behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)

Fork pull requests also do not receive repository secrets (apart from a constrained `GITHUB_TOKEN`), so signing, notarization, and authenticated publication cannot be exercised faithfully there. Using `pull_request_target` to obtain secrets while executing PR code is specifically unsafe; GitHub recommends ordinary `pull_request` when secret access is unnecessary. [Using secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets), [securely using `pull_request_target`](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)

PR CI remains useful as a fast build/test check, but a maintainer-triggered branch rehearsal is the closer release test.

## Artifact validation

Each platform job should upload its distributable with `actions/upload-artifact`. A downstream job should depend on every matrix/build job, use `actions/download-artifact` to assemble the complete set, and verify at least:

- every expected platform/architecture is present;
- exact filenames and extensions match release conventions;
- archives/installers can be opened or inspected by the appropriate native tool;
- checksum and manifest generation succeeds;
- no unexpected duplicate or missing artifacts exist.

GitHub artifacts persist build output and allow it to move between jobs. Downloading automatically recalculates the upload SHA-256 digest and compares it, but a mismatch is reported as a warning, not necessarily a failed validation job; explicit release-set checks are still required. [Store and share workflow artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data), [artifact digest validation](https://docs.github.com/en/actions/tutorials/store-and-share-data#validating-artifacts)

Use `needs` so validation starts only after all build jobs succeed, and publish starts only after validation succeeds. By default, a failed or skipped prerequisite causes dependent jobs to be skipped. A matrix is GitHub's supported way to run the real OS/architecture combinations. [Using jobs, dependencies, and matrices](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs)

The dry-run artifacts remain downloadable from the workflow run, allowing manual installation/smoke testing on each platform before a tag is created.

## Publication controls

Attach only the publish job to a protected `production` environment. GitHub environments can require reviewers, prevent self-approval, prevent administrator bypass, restrict allowed branches/tags, and withhold environment secrets until protection rules pass. [Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [reviewing deployments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments)

Keep workflow-level permissions at `contents: read`; grant `contents: write` only on the gated publish job, since that permission allows creating releases. [Workflow permission syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions)

For stronger protection against rehearsal/release drift, extract build/package/validate into a reusable `workflow_call` workflow and invoke that same implementation from PR checks, manual rehearsals, and the tag release entry point. Reusable workflows support typed inputs, secrets, and matrix callers. [Reusing workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)

## Practical rollout

Because `workflow_dispatch` must be present on the default branch, this capability itself cannot be manually dispatched from its first feature branch. Review and merge the non-publishing workflow change first. Thereafter, every release-related branch can run the complete multi-platform rehearsal from Actions (or `gh workflow run`) before any release tag is pushed.
