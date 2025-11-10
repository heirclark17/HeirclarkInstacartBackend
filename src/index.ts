// index.ts (replace your verifyShopifyProxy with this)
const SHOPIFY_PUBLIC_PREFIX = process.env.SHOPIFY_PUBLIC_PREFIX || '/apps/instacart';

function verifyShopifyProxy(req: Request, res: Response, next: NextFunction): void {
  try {
    const q = req.query as Record<string, QVal>;
    const { signature, ...rest } = q;

    if (!signature) return void res.status(401).send('Missing signature');
    if (!SHOPIFY_APP_SECRET) return void res.status(401).send('No app secret');

    // 1) Sort params (excluding signature)
    const sorted = Object.keys(rest)
      .sort()
      .map(k => `${k}=${toStr(rest[k])}`)
      .join('&');

    // 2) Build the EXACT public path Shopify used to sign:
    //    <public prefix><actual route on the proxy>
    //    e.g. /apps/instacart + /build-list  => /apps/instacart/build-list
    const publicPath = `${SHOPIFY_PUBLIC_PREFIX}${req.path}`;

    // 3) HMAC over "<publicPath>?<sorted>" (omit '?' if no params)
    const data = sorted ? `${publicPath}?${sorted}` : publicPath;

    const computed = crypto.createHmac('sha256', SHOPIFY_APP_SECRET).update(data).digest('hex');
    if (computed !== toStr(signature)) return void res.status(401).send('Bad signature');

    next();
  } catch {
    res.status(401).send('Signature check failed');
  }
}
