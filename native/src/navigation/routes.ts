export type RootStack = {
  Connect: undefined;
  RelayAddress: undefined;
  SignIn: undefined;
  Register: undefined;
  DirectConnect: undefined;
  Workbench: undefined;
  Thread: { deviceKey: string; threadId: string };
  NewThread: { deviceKey: string; workspaceId?: string };
  Settings: undefined;
  PullRequests: { deviceKey: string };
  PullRequest: { deviceKey: string; url: string };
};
