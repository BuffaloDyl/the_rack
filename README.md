# The Rack
Manually stretch your lightning network payments

# What is the Rack?
The Rack is a privacy tool for the lightning network. On the lightning network, payments pass through routing nodes called "hops." Each hop adds additional privacy to your payment, but each one also adds more latency and raises the likelihood of a payment failure. Many lightning wallets focus on ensuring payments are fast and reliable, so they optimize payments to use as few hops as possible, which harms user privacy. The Rack lets you turn that around by using the excellent lnproxy network to manually add extra hops to your payments.

# How do I use it?
Just click here: https://rack.supertestnet.org

# How can I help?
You can help by running a proxy. The more proxies there are on the lightning network, the better privacy users can have. Proxies also count as lightning network routing nodes, which means you can earn money by running this software. But there's a special advantage: proxies theoretically make more money than other routing nodes.

# What? I can make money by running this software?
Yep! Bitcoiners who are interested in privacy are often willing to pay extra for it. By running this software, you become a routing node that offers a distinct privacy enhancement, so you can charge *higher* fees than other routing nodes.

# How do I do it? Gimme gimme gimme!
1. Install a copy of nodejs and the npm package manager
2. Install a copy of LND, either from [here](https://github.com/lightningnetwork/lnd/releases/) or using something like [Voltage](https://www.voltage.cloud/)
3. Open some channels -- I recommend buying inbound capacity from one of [these LSPs](https://supertestnet.github.io/list-of-channel-sellers/) -- make sure you have some inbound capacity AND some outbound capacity
4. Create a directory on your computer called `the_rack` and enter that directory
5. Download a copy of the `index.js` file from this project and put it in `the_rack` directory
6. Open the `index.js` file in a text editor (e.g. Microsoft Notepad) and modify the top four lines, namely: insert your admin macaroon, your LND endpoint, and set a base fee (recommended: 10 sats) and a parts-per-million fee (recommended: 5000 parts per million)
7. Using your command line or terminal, run this command to turn your directory into a nodejs app: `npm init -y`
8. Install the app's dependencies by entering the following command into your command line or terminal: `npm i request crypto bolt11 noble-secp256k1 ws`
9. Run the app by entering the following command into your command line or terminal: `node index.js`

That's it! Your app should immediately list itself on nostr as a proxy for the lightning network, and people may select you as an extra hop in their payments. You earn extra fees and they get extra privacy. It's a win-win!
