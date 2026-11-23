const PULL_REQUEST_FIELDS = `
  number
  url
  title
  body
  state
  createdAt
  mergedAt
  closedAt
  headRefName
  headRefOid
  baseRefName
  isCrossRepository
  headRepository {
    nameWithOwner
  }
`;

const RATE_LIMIT = `
  rateLimit {
    limit
    cost
    remaining
    resetAt
  }
`;

export const PULL_REQUESTS_BY_BRANCH = `query PullRequestsByBranch($owner: String!, $repo: String!, $branch: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(headRefName: $branch, first: 10, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes {${PULL_REQUEST_FIELDS}}
    }
  }${RATE_LIMIT}}`;

export const PULL_REQUESTS_BY_SEARCH = `query PullRequestsBySearch($q: String!) {
  search(query: $q, type: ISSUE_ADVANCED, first: 20) {
    issueCount
    nodes {
      __typename
      ... on PullRequest {${PULL_REQUEST_FIELDS}}
    }
  }${RATE_LIMIT}}`;

export const PULL_REQUEST_BY_NUMBER = `query PullRequestByNumber($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {${PULL_REQUEST_FIELDS}}
  }${RATE_LIMIT}}`;

const COMMIT_HISTORY_PAGE = `
  totalCount
  pageInfo {
    hasNextPage
    endCursor
  }
  nodes {
    commit {
      oid
      url
      message
      committedDate
      author {
        name
        user {
          login
        }
      }
    }
  }
`;

export const PULL_REQUEST_SIGNALS = `query PullRequestSignals($owner: String!, $repo: String!, $number: Int!, $head: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      state
      mergeable
      title
      baseRefName
      history: commits(first: 100) {${COMMIT_HISTORY_PAGE}}
      baseRef {
        compare(headRef: $head) {
          behindBy
        }
      }
      commits(last: 1) {
        nodes {
          commit {
            oid
            statusCheckRollup {
              state
              contexts(first: 100) {
                totalCount
                pageInfo {
                  hasNextPage
                }
                nodes {
                  __typename
                  ... on CheckRun {
                    name
                    conclusion
                  }
                  ... on StatusContext {
                    context
                    state
                  }
                }
              }
            }
          }
        }
      }
    }
  }${RATE_LIMIT}}`;

export const PULL_REQUEST_COMMITS_PAGE = `query PullRequestCommitsPage($owner: String!, $repo: String!, $number: Int!, $after: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      history: commits(first: 100, after: $after) {${COMMIT_HISTORY_PAGE}}
    }
  }${RATE_LIMIT}}`;

export const VIEWER = `query Viewer {
  viewer {
    login
  }${RATE_LIMIT}}`;

export const RATE_LIMIT_ONLY = `query RateLimit {${RATE_LIMIT}}`;
