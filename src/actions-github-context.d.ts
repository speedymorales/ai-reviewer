declare module "@actions/github/lib/context" {
  import { WebhookPayload } from "@actions/github/lib/interfaces";

  export class Context {
    payload: WebhookPayload;
    eventName: string;
    sha: string;
    ref: string;
    workflow: string;
    action: string;
    actor: string;
    job: string;
    runAttempt: number;
    runNumber: number;
    runId: number;
    apiUrl: string;
    serverUrl: string;
    graphqlUrl: string;
    constructor();
    get issue(): { owner: string; repo: string; number: number };
    get repo(): { owner: string; repo: string };
  }
}