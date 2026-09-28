export type RouteParams = Record<string, string>;

export type RouteHandler = (request: Request, params: RouteParams) => Response | Promise<Response>;

export type ResolvedRoute = {
  template: string;
  dispatch: () => Response | Promise<Response>;
};
