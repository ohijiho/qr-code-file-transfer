import { promisify } from 'util';
import https from 'https';
import express from 'express';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import * as uuid from 'uuid';
import { HostServer } from './host.mjs';
import { RelayServer } from './relay.mjs';
import { relayers, httpsOptions, httpsPort, httpPort } from './configs.mjs';

const IDENTITY_KEY = 'identity';

const app = express();
app.use(cookieParser());
app.use(bodyParser.json({ type: 'application/json' }));

const hostServer = new HostServer(relayers);
const relayServer = new RelayServer(60000);

app.use((req, res, next) => {
  console.log(req.path);
  if (!req.cookies[IDENTITY_KEY]) {
    const identity = uuid.v4();
    req.cookies[IDENTITY_KEY] = identity;
    res.cookie(IDENTITY_KEY, identity);
  }
  next();
});

app.post('/api/host/open', (req, res) => {
  try {
    const hid = hostServer.open(req.cookies[IDENTITY_KEY], new Date().getTime() + 60000);

    res.json({
      hid,
    });
  } catch (e) {
    handleHostServerError(e, res);
  }
});

app.post('/api/host/close/:hid', (req, res) => {
  try {
    const hid = hostServer.close(req.params.hid, req.cookies[IDENTITY_KEY]);

    res.json({
      hid,
    });
  } catch (e) {
    handleHostServerError(e, res);
  }
})

app.post('/api/host/accept/:hid', async (req, res) => {
  try {
    const d = await hostServer.accept(req.params.hid, req.cookies[IDENTITY_KEY]);
    if (d) {
      res.json({
        ok: true,
        location: d.location,
        message: d.message,
      });
    } else {
      res.json({
        ok: false,
      });
    }
  } catch (e) {
    handleHostServerError(e, res);
  }
});

app.post('/api/host/connect/:hid', (req, res) => {
  try {
    const location = hostServer.connect(req.params.hid, req.body.message);

    res.json({
      location,
    });
  } catch (e) {
    handleHostServerError(e, res);
  }
});

app.post('/api/host/connect', (req, res) => {
  try {
    const location = hostServer.genLocation();

    res.json({
      location,
    });
  } catch (e) {
    handleHostServerError(e, res);
  }
});

app.post('/api/relay/:sid/open', (req, res) => {
  try {
    relayServer.open(req.params.sid, req.cookies[IDENTITY_KEY]);
    res.json({});
  } catch (e) {
    handleRelayServerError(e, res);
  }
});

app.post('/api/relay/:sid/close', (req, res) => {
  try {
    relayServer.close(req.params.sid, req.cookies[IDENTITY_KEY]);
    res.json({});
  } catch (e) {
    handleRelayServerError(e, res);
  }
});

app.post('/api/relay/:sid/send', async (req, res) => {
  if (!req.is('application/octet-stream')) {
    res.sendStatus(415);
    return;
  }
  res.set('Content-Type', 'application/octet-stream');
  try {
    await relayServer.send(req.params.sid, req.cookies[IDENTITY_KEY], req);
    res.end();
  } catch (e) {
    handleRelayServerError(e, res);
  }
});

app.post('/api/relay/:sid/recv', async (req, res) => {
  res.set('Content-Type', 'application/octet-stream');
  try {
    await relayServer.recv(req.params.sid, req.cookies[IDENTITY_KEY], res);
    res.end();
  } catch (e) {
    handleRelayServerError(e, res);
  }
});

app.get('/api/relay/:sid/closed', (req, res) => {
  try {
    const closed = relayServer.isClosed(req.params.sid, req.cookies[IDENTITY_KEY], res);
    res.json({
      closed,
    });
  } catch (e) {
    handleRelayServerError(e, res);
  }
})

function handleHostServerError(e, res) {
  let status = 500;
  if (e.code === HostServer.ErrorCode.noSuchHost) status = 404;
  else if (e.code === HostServer.ErrorCode.wrongKey) status = 403;
  else {
    console.error(e);
  }
  res.sendStatus(status);
}

function handleRelayServerError(e, res) {
  let status = 500;
  if (e.code === RelayServer.ErrorCode.noSuchSocket) status = 404;
  else if (e.code === RelayServer.ErrorCode.wrongKey) status = 403;
  else if (e.code === RelayServer.ErrorCode.alreadyEstablished) status = 409;
  else if (e.code === RelayServer.ErrorCode.alreadyClosed) status = 409;
  else if (e.code === RelayServer.ErrorCode.timeout) status = 418;
  else {
    console.error(e);
  }
  res.sendStatus(status);
}

app.use(express.static('../static'));
app.get('/favicon.ico', (req, res) => {
  res.end();
});

https.createServer(httpsOptions, app).listen(httpsPort, () => {
  console.log(`listening at port ${httpsPort}`);
});

setInterval(() => {
  hostServer.prune();
  relayServer.prune();

  console.log(`${hostServer.dbgHostsOpen} hosts are currently open`);
  console.log(`${hostServer.dbgTotalListeners} listeners are currently waiting`);
  console.log(`${relayServer.dbgSocksOpen} sockets are currently open`);
  console.log(`${relayServer.dbgTotalUnfulfilled} relay requests are unfulfilled`);
  console.log(`${relayServer.dbgTotalQueued} relay requests are queued`);
}, 60000);
