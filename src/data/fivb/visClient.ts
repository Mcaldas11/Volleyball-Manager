/**
 * Client for the FIVB VIS Web Service.
 *
 * VIS is the Volleyball Information System — the FIVB's own database behind
 * the official player pages, tournament results and world rankings. It exposes
 * an XML-over-HTTP interface at:
 *
 *   https://www.fivb.org/Vis2009/XmlRequest.asmx
 *
 * A request is an XML element naming a request type and the fields wanted:
 *
 *   <Request Type="GetVolleyPlayer" No="12345" Fields="No FirstName LastName"/>
 *
 * Requests may be sent in the query string, but the FIVB documentation warns
 * that URLs are capped near 4KB and long requests are refused, so this client
 * always POSTs form data.
 *
 * ── On data licensing ──────────────────────────────────────────────────────
 *
 * The VIS database is the FIVB's property and access to most fields is gated
 * behind credentials the FIVB issues. This project therefore ships NO FIVB
 * data. What it ships is this client and the mapping layer beside it: if you
 * hold VIS credentials, you can import real players into your own local save.
 * The generated world exists so the game is complete and playable without
 * them. Imported data stays on the machine that imported it — `saves/` and
 * `data/fivb-cache/` are both git-ignored for exactly this reason.
 */

export interface VisCredentials {
  /**
   * Application ID issued by the FIVB, sent as the `X-FIVB-App-ID` header.
   * Determines which fields the response is allowed to contain.
   */
  appId?: string;
  /** Username/password authentication, for accounts issued one. */
  username?: string;
  password?: string;
}

export interface VisClientOptions extends VisCredentials {
  endpoint?: string;
  /** Milliseconds between requests. VIS is a shared public service. */
  throttleMs?: number;
  fetchImpl?: typeof fetch;
}

export const VIS_ENDPOINT = 'https://www.fivb.org/Vis2009/XmlRequest.asmx';

/** One element from a VIS response: a tag, its attributes, and its children. */
export interface VisNode {
  tag: string;
  attrs: Record<string, string>;
  children: VisNode[];
}

export class VisError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'VisError';
  }
}

export class VisClient {
  private readonly endpoint: string;
  private readonly throttleMs: number;
  private readonly doFetch: typeof fetch;
  private lastRequestAt = 0;

  constructor(private readonly options: VisClientOptions = {}) {
    this.endpoint = options.endpoint ?? VIS_ENDPOINT;
    this.throttleMs = options.throttleMs ?? 350;
    this.doFetch = options.fetchImpl ?? globalThis.fetch;
    if (typeof this.doFetch !== 'function') {
      throw new VisError('No fetch implementation available');
    }
  }

  /**
   * Send one request and return the parsed response nodes.
   */
  async request(
    type: string,
    attrs: Record<string, string | number | undefined> = {},
    body = '',
  ): Promise<VisNode[]> {
    const xml = buildRequest(type, attrs, body, this.options);
    const text = await this.post(xml);
    const root = parseXml(text);
    // The service wraps results in <Response>; some request types return the
    // payload elements directly.
    const wrapper = root.find((n) => n.tag === 'Response');
    return wrapper !== undefined ? wrapper.children : root;
  }

  private async post(requestXml: string): Promise<string> {
    // Simple throttle so a bulk import does not hammer a shared service.
    const wait = this.lastRequestAt + this.throttleMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (this.options.appId !== undefined) headers['X-FIVB-App-ID'] = this.options.appId;

    const res = await this.doFetch(this.endpoint, {
      method: 'POST',
      headers,
      body: `Request=${encodeURIComponent(requestXml)}`,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new VisError(
        `VIS request failed with HTTP ${res.status}`,
        res.status,
        text.slice(0, 500),
      );
    }
    if (text.includes('<Error')) {
      throw new VisError(`VIS returned an error: ${text.slice(0, 300)}`, res.status, text);
    }
    return text;
  }

  /** Fetch a single registered player by their FIVB number. */
  async getVolleyPlayer(playerNo: number, fields = VOLLEY_PLAYER_FIELDS): Promise<VisNode | null> {
    const nodes = await this.request('GetVolleyPlayer', { No: playerNo, Fields: fields });
    return nodes.find((n) => n.tag === 'VolleyPlayer') ?? nodes[0] ?? null;
  }

  /**
   * Fetch a list of players.
   *
   * `GetVolleyPlayerList` returns tournament *registrations*, so a player who
   * appears in several tournaments comes back more than once. The importer
   * deduplicates on the player number.
   */
  async getVolleyPlayerList(
    filter: Record<string, string | number> = {},
    fields = VOLLEY_PLAYER_FIELDS,
  ): Promise<VisNode[]> {
    const filterXml = `<Filter ${attrString(filter)}/>`;
    const nodes = await this.request('GetVolleyPlayerList', { Fields: fields }, filterXml);
    return collect(nodes, 'VolleyPlayer');
  }

  /** Fetch the world ranking for a given ranking type. */
  async getVolleyPlayersRanking(
    filter: Record<string, string | number> = {},
  ): Promise<VisNode[]> {
    const filterXml = `<Filter ${attrString(filter)}/>`;
    const nodes = await this.request(
      'GetVolleyPlayersRanking',
      { Fields: 'Rank PlayerNo Points TeamName' },
      filterXml,
    );
    return collect(nodes, 'VolleyPlayerRanking');
  }

  /** Fetch tournaments, used to discover which players to import. */
  async getVolleyTournamentList(
    filter: Record<string, string | number> = {},
  ): Promise<VisNode[]> {
    const filterXml = `<Filter ${attrString(filter)}/>`;
    const nodes = await this.request(
      'GetVolleyTournamentList',
      { Fields: 'No Name Season StartDate EndDate CountryCode' },
      filterXml,
    );
    return collect(nodes, 'VolleyTournament');
  }
}

/**
 * The fields worth requesting for a player. Which of these actually come back
 * depends on the access level of the credentials in use — VIS silently omits
 * fields the caller is not entitled to rather than failing the request.
 */
export const VOLLEY_PLAYER_FIELDS = [
  'No', 'FirstName', 'LastName', 'TeamName', 'FederationCode',
  'Gender', 'Birthdate', 'Height', 'Weight', 'SpikeReach', 'BlockReach',
  'Position', 'ShirtNumber', 'PlaysFor', 'Nationality', 'TournamentNo',
].join(' ');

function buildRequest(
  type: string,
  attrs: Record<string, string | number | undefined>,
  body: string,
  creds: VisCredentials,
): string {
  const all: Record<string, string | number> = { Type: type };
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) all[k] = v;
  }
  if (creds.username !== undefined) all.Username = creds.username;
  if (creds.password !== undefined) all.Password = creds.password;

  const open = `<Request ${attrString(all)}`;
  return body === '' ? `${open}/>` : `${open}>${body}</Request>`;
}

function attrString(attrs: Record<string, string | number>): string {
  return Object.entries(attrs)
    .map(([k, v]) => `${k}="${escapeXml(String(v))}"`)
    .join(' ');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

/**
 * Minimal XML reader.
 *
 * VIS responses are shallow trees of elements carrying all their data in
 * attributes — there is no mixed content and no text nodes to speak of. That
 * makes a small hand-rolled reader sufficient, and avoids both a dependency
 * and the fact that `DOMParser` does not exist in Node.
 */
export function parseXml(text: string): VisNode[] {
  const roots: VisNode[] = [];
  const stack: VisNode[] = [];
  // Matches an element tag: name, attribute block, and whether self-closing.
  const tagRe = /<(\/)?([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/)?>/g;
  const attrRe = /([\w.:-]+)\s*=\s*"([^"]*)"/g;

  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(text)) !== null) {
    const [, closing, tag, attrBlock, selfClosing] = m;

    if (closing !== undefined) {
      stack.pop();
      continue;
    }

    const attrs: Record<string, string> = {};
    if (attrBlock !== undefined) {
      attrRe.lastIndex = 0;
      let a: RegExpExecArray | null;
      while ((a = attrRe.exec(attrBlock)) !== null) {
        attrs[a[1]] = unescapeXml(a[2]);
      }
    }

    const node: VisNode = { tag, attrs, children: [] };
    const parent = stack[stack.length - 1];
    if (parent !== undefined) parent.children.push(node);
    else roots.push(node);

    if (selfClosing === undefined) stack.push(node);
  }
  return roots;
}

/** Depth-first collection of every node with the given tag. */
export function collect(nodes: VisNode[], tag: string): VisNode[] {
  const out: VisNode[] = [];
  const walk = (list: VisNode[]): void => {
    for (const n of list) {
      if (n.tag === tag) out.push(n);
      if (n.children.length > 0) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}
