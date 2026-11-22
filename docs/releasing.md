# Releasing

This guide is for maintainers. To build a dmg by hand, see [Build a release dmg](../CONTRIBUTING.md#build-a-release-dmg).

## Make a release

Releases are made by GitHub Actions. There is no changelog file; Release notes are generated from merged pull requests.

Feature work goes to `develop`, the default branch. `main` only changes when you release or ship a hotfix, and `develop` always contains every commit on `main`:

- Pull requests to `main` come only from `release/*` and `hotfix/*` branches of this repository, and the branch must contain the latest `main`. The `main-pr` job (`.github/workflows/main-pr.yml`) checks this so a release cut from an old `develop` cannot undo a hotfix. It runs again when a pull request is retargeted to `main`. With "require branches to be up to date" on `main`, GitHub also asks you to merge `main` into the branch when `main` moves while the pull request is open. The job passes without checking anything while the repository has no `develop` branch.
- After every push to `main`, **Sync develop** (`.github/workflows/sync-develop.yml`) merges `main` into `develop` with a merge commit. If they conflict, it pushes nothing to `develop` and opens a pull request from `sync/main-to-develop` to `develop` instead; resolve it there and merge it with a merge commit. Sync develop does nothing while there is no `develop` branch.

To release what is on `develop`:

1. In the Actions tab, run **Prepare release** on `develop` with the new version, without the `v` (such as `0.1.0` or `0.1.0-rc.2`), and leave **source** as `develop`. It cuts `release/v<version>` from `develop`, changes the `version` in `package.json` and `apps/desktop/package.json`, and opens a pull request to `main`. The version must be higher than the current one.
2. Merge that pull request after its checks pass. On the push to `main`, **Tag release** (`.github/workflows/tag-release.yml`) sees that both versions changed to the same higher version and creates the `v<version>` tag on the merge commit.
3. The tag push starts **Release** (`.github/workflows/release.yml`). It checks that the tag matches both versions and that its commit is on `main`, runs the CI checks, builds and signs the dmg on a macOS runner with a certificate and API key from the `release` environment, verifies the signature, notarization, and Gatekeeper assessment of the dmg and the update zip, and then creates the Release with the dmg and the update files.

A tag with a `-` (such as `v0.1.0-rc.1`) makes a prerelease, and a stable Release collects notes from the previous stable tag. Tag release does nothing when the versions did not change or the tag already points at the merge commit. It fails when only one of the two versions changed, when the version is lower, when the version is not like `1.2.3` or `1.2.3-rc.1`, or when the tag already points at another commit. Release stops before building when a Release for the tag already exists.

To ship a hotfix, branch `hotfix/<name>` from `main`, commit the fix, and open a pull request to `main`. Then run **Prepare release** on `develop` with the new version and **source** set to `hotfix/<name>`. It adds the version change to that branch and uses its open pull request to `main`, or opens one. Prepare release runs its own scripts from `develop` and only reads the version files on the hotfix branch. Merge the pull request to release the hotfix. A hotfix merged without a version change does not make a tag or a Release; it reaches users with the next release. Any other **source** is refused.

An administrator can still push a `v*` tag by hand to release a commit on `main`. `release.yml` can also be called from another workflow with a `tag` input, but its signing job only gets the `release` environment when the calling run is on a `v*` tag.

## Automatic releases

Tags, pushes, and pull requests made with the default `GITHUB_TOKEN` do not start other workflows, so Prepare release, Tag release, and Sync develop use a GitHub App token instead. The app's key lives in a `release-bot` environment that only `main` and `develop` can use; the signing secrets stay in the `release` environment, which only `v*` tags can use. Set this up once, before you merge a version change. Replace `OWNER/REPO` with your repository.

1. Create a GitHub App (Settings > Developer settings > GitHub Apps > New GitHub App) under the account that owns the repository:
   - Homepage URL: the repository URL.
   - Webhook: clear **Active**.
   - Repository permissions: **Contents** read and write, **Pull requests** read and write, **Workflows** read and write. Leave everything else at no access. Sync develop needs **Workflows** to merge a `main` that changed files in `.github/workflows`. If you add it to an existing app, accept the new permission on the installation.
   - Where can this GitHub App be installed: **Only on this account**.
2. On the app's page, note the **App ID** and generate a private key (a `.pem` file).
3. Install the app (Install App) on this repository only.
4. Create the `release-bot` environment and allow only the `main` and `develop` branches to use it:

   ```sh
   gh api --method PUT repos/OWNER/REPO/environments/release-bot \
     -F 'deployment_branch_policy[protected_branches]=false' \
     -F 'deployment_branch_policy[custom_branch_policies]=true'
   gh api --method POST repos/OWNER/REPO/environments/release-bot/deployment-branch-policies \
     -f name=main -f type=branch
   gh api --method POST repos/OWNER/REPO/environments/release-bot/deployment-branch-policies \
     -f name=develop -f type=branch
   ```

5. Store the app ID and key in that environment, then delete the local `.pem` file:

   ```sh
   gh secret set RELEASE_APP_ID --env release-bot --repo OWNER/REPO --body <app-id>
   gh secret set RELEASE_APP_PRIVATE_KEY --env release-bot --repo OWNER/REPO < <key>.pem
   ```

6. If a ruleset limits who can create `v*` tags, add the app to its bypass list. `PUT` replaces the whole list, so this keeps the actors that are already there and adds the app:

   ```sh
   ruleset_id="$(gh api repos/OWNER/REPO/rulesets --jq '.[] | select(.name == "Release tags") | .id')"
   gh api "repos/OWNER/REPO/rulesets/$ruleset_id" \
     | jq --argjson app <app-id> '{bypass_actors: (.bypass_actors + [{actor_id: $app, actor_type: "Integration", bypass_mode: "always"}])}' \
     | gh api --method PUT "repos/OWNER/REPO/rulesets/$ruleset_id" --input -
   ```

7. Optional, recommended when pull requests can be merged without a person: require a reviewer on the `release` environment. With the app, anyone who can merge to `main` can make a tag and so start signing; a required reviewer keeps one human approval before the signing job reads the certificate. Replace `<user-id>` with your GitHub user ID (`gh api user --jq .id`):

   ```sh
   gh api --method PUT repos/OWNER/REPO/environments/release \
     -F 'reviewers[][type]=User' -F 'reviewers[][id]=<user-id>' \
     -F 'deployment_branch_policy[protected_branches]=false' \
     -F 'deployment_branch_policy[custom_branch_policies]=true'
   ```

8. Create `develop` from `main`, make it the default branch, and protect it like `main`: changes only through pull requests, the `check` status check required, no force pushes or deletion, and the app on the bypass list so Sync develop can push its merge commit. Then add `main-pr` to the required status checks of `main` and require branches to be up to date before merging. Set `APP_ID` to the app ID first:

   ```sh
   gh api --method POST repos/OWNER/REPO/git/refs \
     -f ref=refs/heads/develop -f sha="$(gh api repos/OWNER/REPO/git/ref/heads/main --jq .object.sha)"
   gh api --method PATCH repos/OWNER/REPO -f default_branch=develop
   jq -n --argjson app "$APP_ID" '{
     name: "develop", target: "branch", enforcement: "active",
     conditions: {ref_name: {include: ["refs/heads/develop"], exclude: []}},
     bypass_actors: [{actor_id: $app, actor_type: "Integration", bypass_mode: "always"}],
     rules: [
       {type: "deletion"}, {type: "non_fast_forward"},
       {type: "pull_request", parameters: {required_approving_review_count: 0, dismiss_stale_reviews_on_push: false, require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: false}},
       {type: "required_status_checks", parameters: {strict_required_status_checks_policy: false, required_status_checks: [{context: "check"}]}}
     ]}' | gh api --method POST repos/OWNER/REPO/rulesets --input -
   gh api --method POST repos/OWNER/REPO/branches/main/protection/required_status_checks/contexts \
     --input - <<< '{"contexts": ["main-pr"]}'
   gh api --method PATCH repos/OWNER/REPO/branches/main/protection/required_status_checks \
     -F strict=true
   ```

Without these settings, Prepare release, Tag release, and Sync develop stop with an error that points here. If a job runs before the `release-bot` environment exists, GitHub creates the environment without the branch rule, so do step 4 first. After you finish, re-run a failed Tag release run to create the tag.
