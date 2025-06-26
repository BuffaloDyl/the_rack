/*

THESE NEXT LINES ARE CUSTOMIZABLE SETTINGS

*/

var adminmac = "";
var lndendpoint = ""; //e.g. https://127.0.0.1:8080 or https://cloud-59.voltage.com
var base_fee = 10; //to charge people more for routing through your node, increase 10 -- it is measured in sats and I recommend a minimum of at least 2, otherwise you often get errors where the outgoing amount pays an insufficient fee
var ppm_fee = 5000; //this value charges a .5% fee by default for routing through your node; modify it to charge more or less

/*

END OF CUSTOMIZABLE SETTINGS - DON'T TOUCH ANYTHING AFTER THIS POINT

*/

//REMEMBER: npm i request crypto bolt11 noble-secp256k1 ws

var nobleSecp256k1 = require( 'noble-secp256k1' );
var WebSocket = require( 'ws' ).WebSocket;
var request = require( 'request' );
var crypto = require( 'crypto' );
var bolt11 = require( 'bolt11' );
var relays = [ "wss://nostrue.com" ];
var my_nostr_keys = [];
var stopped_connections = [];
var handled_messages = [];

var super_nostr = {
    sockets: {},
    hexToBytes: hex => Uint8Array.from( hex.match( /.{1,2}/g ).map( byte => parseInt( byte, 16 ) ) ),
    bytesToHex: bytes => bytes.reduce( ( str, byte ) => str + byte.toString( 16 ).padStart( 2, "0" ), "" ),
    hexToBase64: hex => btoa( hex.match( /\w{2}/g ).map( a => String.fromCharCode( parseInt( a, 16 ) ) ).join( "" ) ),
    base64ToHex: str => {
        var raw = atob( str );
        var result = '';
        var i; for ( i=0; i<raw.length; i++ ) {
            var hex = raw.charCodeAt( i ).toString( 16 );
            result += hex.length % 2 ? '0' + hex : hex;
        }
        return result.toLowerCase();
    },
    base64ToBytes: str => {
        var raw = atob( str );
        var result = [];
        var i; for ( i=0; i<raw.length; i++ ) result.push( raw.charCodeAt( i ) );
        return new Uint8Array( result );
    },
    getPrivkey: () => super_nostr.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() ),
    getPubkey: privkey => nobleSecp256k1.getPublicKey( privkey, true ).substring( 2 ),
    sha256: async text_or_bytes => {if ( typeof text_or_bytes === "string" ) text_or_bytes = ( new TextEncoder().encode( text_or_bytes ) );return super_nostr.bytesToHex( await nobleSecp256k1.utils.sha256( text_or_bytes ) )},
    waitSomeSeconds: num => {
        var num = num.toString() + "000";
        num = Number( num );
        return new Promise( resolve => setTimeout( resolve, num ) );
    },
    getEvents: async ( relay_or_socket, ids, authors, kinds, until, since, limit, etags, ptags ) => {
        var socket_is_permanent = false;
        if ( typeof relay_or_socket !== "string" ) socket_is_permanent = true;
        if ( typeof relay_or_socket === "string" ) var socket = new WebSocket( relay_or_socket );
        else var socket = relay_or_socket;
        var events = [];
        var opened = false;
        if ( socket_is_permanent ) {
            var subId = super_nostr.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() ).substring( 0, 16 );
            var filter  = {}
            if ( ids ) filter.ids = ids;
            if ( authors ) filter.authors = authors;
            if ( kinds ) filter.kinds = kinds;
            if ( until ) filter.until = until;
            if ( since ) filter.since = since;
            if ( limit ) filter.limit = limit;
            if ( etags ) filter[ "#e" ] = etags;
            if ( ptags ) filter[ "#p" ] = ptags;
            var subscription = [ "REQ", subId, filter ];
            socket.send( JSON.stringify( subscription ) );
            return;
        }
        socket.addEventListener( 'message', async function( message ) {
            var [ type, subId, event ] = JSON.parse( message.data );
            var { kind, content } = event || {}
            if ( !event || event === true ) return;
            events.push( event );
        });
        socket.addEventListener( 'open', async function( e ) {
            opened = true;
            var subId = super_nostr.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() ).substring( 0, 16 );
            var filter  = {}
            if ( ids ) filter.ids = ids;
            if ( authors ) filter.authors = authors;
            if ( kinds ) filter.kinds = kinds;
            if ( until ) filter.until = until;
            if ( since ) filter.since = since;
            if ( limit ) filter.limit = limit;
            if ( etags ) filter[ "#e" ] = etags;
            if ( ptags ) filter[ "#p" ] = ptags;
            var subscription = [ "REQ", subId, filter ];
            socket.send( JSON.stringify( subscription ) );
        });
        var loop = async () => {
            if ( !opened ) {
                await super_nostr.waitSomeSeconds( 1 );
                return await loop();
            }
            var len = events.length;
            await super_nostr.waitSomeSeconds( 1 );
            if ( len !== events.length ) return await loop();
            socket.close();
            return events;
        }
        return await loop();
    },
    prepEvent: async ( privkey, msg, kind, tags ) => {
        var pubkey = super_nostr.getPubkey( privkey );
        if ( !tags ) tags = [];
        // console.log( Math.floor( Date.now() / 1000 ) - 2675 );
        var event = {
            "content": msg,
            "created_at": Math.floor( Date.now() / 1000 ),
            "kind": kind,
            "tags": tags,
            "pubkey": pubkey,
        }
        var signedEvent = await super_nostr.getSignedEvent( event, privkey );
        return signedEvent;
    },
    sendEvent: ( event, relay_or_socket ) => {
        var socket_is_permanent = false;
        if ( typeof relay_or_socket !== "string" ) socket_is_permanent = true;
        if ( typeof relay_or_socket === "string" ) var socket = new WebSocket( relay_or_socket );
        else var socket = relay_or_socket;
        if ( !socket_is_permanent ) {
            socket.addEventListener( 'open', async () => {
                socket.send( JSON.stringify( [ "EVENT", event ] ) );
                setTimeout( () => {socket.close();}, 1000 );
            });
        } else {
            socket.send( JSON.stringify( [ "EVENT", event ] ) );
        }
        return event.id;
    },
    getSignedEvent: async ( event, privkey ) => {
        var eventData = JSON.stringify([
            0,
            event['pubkey'],
            event['created_at'],
            event['kind'],
            event['tags'],
            event['content'],
        ]);
        event.id = await super_nostr.sha256( eventData );
        event.sig = await nobleSecp256k1.schnorr.sign( event.id, privkey );
        return event;
    },
    //the "alt_encrypt" and "alt_decrypt" functions are
    //alternatives to the defaults; I think they are
    //better because they eliminate the dependency
    //on browserify-cipher, but they are asynchronous
    //and I already made so much stuff with this library
    //that assumes synchronicity, I don't want to change
    //it all
    alt_encrypt: async ( privkey, pubkey, text ) => {
        var msg = ( new TextEncoder() ).encode( text );
        var iv = crypto.getRandomValues( new Uint8Array( 16 ) );
        var key_raw = super_nostr.hexToBytes( nobleSecp256k1.getSharedSecret( privkey, '02' + pubkey, true ).substring( 2 ) );
        var key = await crypto.subtle.importKey(
            "raw",
            key_raw,
            "AES-CBC",
            false,
            [ "encrypt", "decrypt" ],
        );
        var emsg = await crypto.subtle.encrypt(
            {
                name: "AES-CBC",
                iv,
            },
            key,
            msg,
        )
        emsg = new Uint8Array( emsg );
        var arr = emsg;
        emsg = super_nostr.hexToBase64( super_nostr.bytesToHex( emsg ) ) + "?iv=" + btoa( String.fromCharCode.apply( null, iv ) );
        return emsg;
    },
    alt_decrypt: async ( privkey, pubkey, ciphertext ) => {
        var [ emsg, iv ] = ciphertext.split( "?iv=" );
        var key_raw = super_nostr.hexToBytes( nobleSecp256k1.getSharedSecret( privkey, '02' + pubkey, true ).substring( 2 ) );
        var key = await crypto.subtle.importKey(
            "raw",
            key_raw,
            "AES-CBC",
            false,
            [ "encrypt", "decrypt" ],
        );
        var decrypted = await crypto.subtle.decrypt(
            {
                name: "AES-CBC",
                iv: super_nostr.base64ToBytes( iv ),
            },
            key,
            super_nostr.base64ToBytes( emsg ),
        );
        var msg = ( new TextDecoder() ).decode( decrypted );
        return msg;
    },
    //var listenFunction = async socket => {
    //    var subId = super_nostr.bytesToHex( crypto.getRandomValues( new Uint8Array( 8 ) ) );
    //    var filter  = {}
    //    filter.kinds = [ 1 ];
    //    filter.limit = 1;
    //    filter.since = Math.floor( Date.now() / 1000 ) - 86400;
    //    var subscription = [ "REQ", subId, filter ];
    //    socket.send( JSON.stringify( subscription ) );
    //}
    //var handleFunction = async message => {
    //    var [ type, subId, event ] = JSON.parse( message.data );
    //    if ( !event || event === true ) return;
    //    console.log( event );
    //}
    newPermanentConnection: ( relay, listenFunction, handleFunction ) => {
        var socket_id = super_nostr.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() ).substring( 0, 16 );
        super_nostr.sockets[ socket_id ] = {socket: null, connection_failure: false}
        super_nostr.connectionLoop( 0, relay, socket_id, listenFunction, handleFunction );
        return socket_id;
    },
    connectionLoop: async ( tries = 0, relay, socket_id, listenFunction, handleFunction ) => {
        if ( stopped_connections.includes( socket_id ) ) return;
        var socketRetrieverFunction = socket_id => {
            return super_nostr.sockets[ socket_id ][ "socket" ];
        }
        var socketReplacerFunction = ( socket_id, socket ) => {
            super_nostr.sockets[ socket_id ][ "socket" ] = socket;
            super_nostr.sockets[ socket_id ][ "connection_failure" ] = false;
        }
        var socketFailureCheckerFunction = socket_id => {
            return super_nostr.sockets[ socket_id ][ "connection_failure" ];
        }
        var socketFailureSetterFunction = socket_id => {
            return super_nostr.sockets[ socket_id ][ "connection_failure" ] = true;
        }
        if ( socketFailureCheckerFunction( socket_id ) ) return alert( `your connection to nostr failed and could not be restarted, please refresh the page` );
        var socket = socketRetrieverFunction( socket_id );
        if ( !socket ) {
            var socket = new WebSocket( relay );
            socket.addEventListener( 'message', handleFunction );
            socket.addEventListener( 'open', ()=>{listenFunction( socket );} );
            socketReplacerFunction( socket_id, socket );
        }
        if ( socket.readyState === 1 ) {
            await super_nostr.waitSomeSeconds( 1 );
            if ( stopped_connections.includes( socket_id ) ) return;
            return super_nostr.connectionLoop( 0, relay, socket_id, listenFunction, handleFunction );
        }
        // if there is no connection, check if we are still connecting
        // give it two chances to connect if so
        if ( socket.readyState === 0 && !tries ) {
            await super_nostr.waitSomeSeconds( 1 );
            if ( stopped_connections.includes( socket_id ) ) return;
            return super_nostr.connectionLoop( 1, relay, socket_id, listenFunction, handleFunction );
        }
        if ( socket.readyState === 0 && tries ) {
            socketFailureSetterFunction( socket_id );
            return;
        }
        // otherwise, it is either closing or closed
        // ensure it is closed, then make a new connection
        socket.close();
        await super_nostr.waitSomeSeconds( 1 );
        if ( stopped_connections.includes( socket_id ) ) return;
        socket = new WebSocket( relay );
        socket.addEventListener( 'message', handleFunction );
        socket.addEventListener( 'open', ()=>{listenFunction( socket );} );
        socketReplacerFunction( socket_id, socket );
        await super_nostr.connectionLoop( 0, relay, socket_id, listenFunction, handleFunction );
    }
}

var sha256 = async s => {
    if ( typeof s == "string" ) s = new TextEncoder().encode( s );
    var arr = await crypto.subtle.digest( 'SHA-256', s );
    return Buffer.from( new Uint8Array( arr ) ).toString( 'hex' );
}

var getRecipientFromNostrEvent = event => {
    var i; for ( i=0; i<event.tags.length; i++ ) {
        if ( event.tags[ i ] && event.tags[ i ][ 0 ] && event.tags[ i ][ 1 ] && event.tags[ i ][ 0 ] == "p" ) return event.tags[ i ][ 1 ];
    }
}

function getLspPubkey() {
    return new Promise( resolve => {
        var macaroon = adminmac;
        var endpoint = lndendpoint + "/v1/getinfo";
        let options = {
            url: endpoint,
            // Work-around for self-signed certificates.
            rejectUnauthorized: false,
            json: true,
            headers: {
                'Grpc-Metadata-macaroon': macaroon,
            }
        }
        request.get(options, function(error, response, body) {
            resolve( body[ "identity_pubkey" ] );
        });        
    });
}

function getHodlInvoice( amount, hash, expiry = 240, desc_hash ) {
    return new Promise( resolve => {
        var invoice = "";
        var macaroon = adminmac;
        var endpoint = lndendpoint + "/v2/invoices/hodl";
        var requestBody = {
            hash: Buffer.from( hash, "hex" ).toString( "base64" ),
            value_msat: amount.toString(),
            cltv_expiry: expiry.toString(),
            private: true,
        }
        if ( desc_hash ) requestBody.description_hash = Buffer.from( desc_hash, "hex" ).toString( "base64" );
        var options = {
            url: endpoint,
            // Work-around for self-signed certificates.
            rejectUnauthorized: false,
            json: true,
            headers: {
                'Grpc-Metadata-macaroon': macaroon,
            },
            form: JSON.stringify(requestBody),
        }
        request.post(options, function(error, response, body) {
            invoice = body[ "payment_request" ];
            resolve( invoice );
        });
    });
}

function getPendingHTLCExpiry( hash ) {
    return new Promise( resolve => {
        var expiry = "";
        var macaroon = adminmac;
        var endpoint = lndendpoint;
        var options = {
            url: endpoint + '/v1/invoice/' + hash,
            // Work-around for self-signed certificates.
            rejectUnauthorized: false,
            json: true,
            headers: {
                'Grpc-Metadata-macaroon': macaroon,
            },
        }
        request.get( options, function( error, response, body ) {
            expiry = body[ "htlcs" ][ 0 ][ "expiry_height" ];
            resolve( expiry );
        });
    });
}

function checkInvoiceStatusWithoutLoop( hash ) {
    return new Promise( resolve => {
        var status = "";
        var macaroon = adminmac;
        var endpoint = lndendpoint;
        var options = {
            url: endpoint + '/v1/invoice/' + hash,
            // Work-around for self-signed certificates.
            rejectUnauthorized: false,
            json: true,
            headers: {
                'Grpc-Metadata-macaroon': macaroon,
            },
        }
        request.get( options, function( error, response, body ) {
            status = body[ "state" ];
            resolve( status );
        });
    });
}

async function checkInvoiceStatus( hash ) {
    var status = "";
    var macaroon = adminmac;
    var endpoint = lndendpoint;
    var options = {
        url: endpoint + '/v1/invoice/' + hash,
        // Work-around for self-signed certificates.
        rejectUnauthorized: false,
        json: true,
        headers: {
            'Grpc-Metadata-macaroon': macaroon,
        },
    }
    request.get( options, function( error, response, body ) {
        status = body[ "state" ];
        console.log( "status:", status );
    });
    var time = 0;
    async function isDataSetYet( data_i_seek ) {
        return new Promise( function( resolve, reject ) {
            if ( data_i_seek != "ACCEPTED" ) {
                setTimeout( async function() {
                    time = time + 1;
                    console.log( "time:", time )
                    if ( time >= 36000 ) {
                        resolve( "failure" );
                        return;
                    }
                    console.log( "checking if buyer sent payment yet..." );
                    status = await checkInvoiceStatusWithoutLoop( hash );
                    console.log( status );
                    var msg = await isDataSetYet( status );
                    resolve( msg );
                }, 100 );
            } else {
                resolve( data_i_seek );
            }
        });
    }
    async function getTimeoutData() {
        var data_i_seek = await isDataSetYet( status );
        return data_i_seek;
    }
    var returnable = await getTimeoutData();
    return returnable;
}

var payInvoice = ( invoice, blocks_til_invoice_that_pays_me_expires, max_outgoing_fee ) => {
    var macaroon = adminmac;
    var endpoint = lndendpoint;
    var reasonable_cltv_limit = blocks_til_invoice_that_pays_me_expires - 2;
    return new Promise( resolve => {
        var requestBody = {
            payment_request: invoice,
            fee_limit: {"fixed": Math.floor( Number( ( max_outgoing_fee / 1000 ).toFixed( 3 ) ) )},
            allow_self_payment: true,
            cltv_limit: Number( reasonable_cltv_limit )
        }
        console.log( requestBody );
        var options = {
            url: endpoint + '/v1/channels/transactions',
            // Work-around for self-signed certificates.
            rejectUnauthorized: false,
            json: true,
            headers: {
              'Grpc-Metadata-macaroon': macaroon,
            },
            form: JSON.stringify( requestBody ),
        }
        request.post( options, function( error, response, body ) {
            console.log( "here is the body:", body );
            var nowdate = new Date().toLocaleDateString();
            var nowtime = new Date().toLocaleTimeString();
            var now = nowdate + " " + nowtime;
            // var texttowrite = ( now + ` -- here is the body: ${JSON.stringify( body )}\n` );
            // fs.appendFile( "logs.txt", texttowrite, function() {return;});
            try {
                if ( body[ "payment_preimage" ] ) resolve( body[ "payment_preimage" ] );
                else throw( `error: ${body[ "payment_error" ]}` );
            } catch ( e ) {
                resolve( `error: ${body[ "payment_error" ]}` );
            }
        });
    });
}

function settleHoldInvoice( preimage ) {
    var settled = "";
    var macaroon = adminmac;
    var endpoint = lndendpoint;
    return new Promise( resolve => {
        var requestBody = {
            preimage: Buffer.from( preimage, "hex" ).toString( "base64" )
        }
        var options = {
            url: endpoint + '/v2/invoices/settle',
            // Work-around for self-signed certificates.
            rejectUnauthorized: false,
            json: true,
            headers: {
                'Grpc-Metadata-macaroon': macaroon,
            },
            form: JSON.stringify( requestBody ),
        }
        request.post( options, function( error, response, body ) {
            console.log( 'settled, right?', body );
            if ( body.toString() === "{}" ) {
                settled = "true";
            } else {
                settled = "false";
            }
            resolve( settled );
        });
    });
}

function cancelHoldInvoice( hash ) {
    var canceled = "";
    var macaroon = adminmac;
    var endpoint = lndendpoint;
    return new Promise( resolve => {
        var requestBody = {
            payment_hash: Buffer.from( hash, "hex" ).toString( "base64" ),
        }
        var options = {
            url: endpoint + '/v2/invoices/cancel',
            // Work-around for self-signed certificates.
            rejectUnauthorized: false,
            json: true,
            headers: {
                'Grpc-Metadata-macaroon': macaroon,
            },
            form: JSON.stringify( requestBody ),
        }
        request.post( options, function( error, response, body ) {
            console.log( 'canceled, right?', body );
            if ( body.toString() === "{}" ) {
                canceled = "true";
            } else {
                canceled = "false";
            }
            resolve( canceled );
        });
    });
}

var getBlockheight = async ( network = "" ) => {
    var data = await fetch( `https://mempool.space/${network}api/blocks/tip/height` );
    return Number( await data.text() );
}

var isValidInvoice = invoice => {
    try {
        return typeof bolt11.decode( invoice ) === "object";
    } catch( e ) {
        return;
    }
}

var getInvoicePmthash = invoice => {
    var decoded = bolt11.decode( invoice );
    var i; for ( i=0; i<decoded[ "tags" ].length; i++ ) {
        if ( decoded[ "tags" ][ i ][ "tagName" ] == "payment_hash" ) return decoded[ "tags" ][ i ][ "data" ].toString();
    }
}

var getInvoiceHardExpiry = invoice => {
    var decoded = bolt11.decode( invoice );
    var i; for ( i=0; i<decoded[ "tags" ].length; i++ ) {
        if ( decoded[ "tags" ][ i ][ "tagName" ] === "min_final_cltv_expiry" && Number( decoded[ "tags" ][ i ][ "data" ] ) >= 1 ) return Number( decoded[ "tags" ][ i ][ "data" ] );
    }
    return 40;
}

var getInvoiceAmount = invoice => {
    var decoded = bolt11.decode( invoice );
    var amount = Math.floor( decoded[ "millisatoshis" ] / 1000 ).toString();
    return Number( amount );
}

var keyLooper = async () => {
    var new_privkey = super_nostr.getPrivkey();
    my_nostr_keys.unshift( new_privkey );
    if ( my_nostr_keys.length > 3 ) my_nostr_keys.length = 3;
    var pubkeys = my_nostr_keys.map( privkey => super_nostr.getPubkey( privkey ) );
    console.log( pubkeys );
    Object.keys( super_nostr.sockets ).forEach( socket_id => {
        if ( stopped_connections.includes( socket_id ) ) return;
        stopped_connections.push( socket_id );
        super_nostr.sockets[ socket_id ].socket.close();
    });
    setTimeout( () => {stopped_connections = [];}, 5000 );
    var listenFunction = async socket => {
       var subId = super_nostr.bytesToHex( crypto.getRandomValues( new Uint8Array( 8 ) ) );
       var filters = [];
       var i; for ( i=0; i<pubkeys.length; i++ ) {
            var filter  = {}
            filter.kinds = [ 4 ];
            filter[ "#p" ] = [ pubkeys[ i ] ];
            filter.since = Math.floor( Date.now() / 1000 );
            filters.push( filter );
       }
       var subscription = [ "REQ", subId, ...filters ];
       socket.send( JSON.stringify( subscription ) );
    }
    var handleFunction = async message => {
        console.log( message.data );
        var [ type, subId, event ] = JSON.parse( message.data );
        if ( !event || event === true ) return;
        if ( handled_messages.includes( event.id ) ) return;
        handled_messages.unshift( event.id );
        var pubkeys = my_nostr_keys.map( privkey => super_nostr.getPubkey( privkey ) );
        var recipient = getRecipientFromNostrEvent( event );
        var privkey = my_nostr_keys[ pubkeys.indexOf( recipient ) ];
        var invoice_to_pay = null;
        var delay = null;
        try {
            event.content = await super_nostr.alt_decrypt( privkey, event.pubkey, event.content );
            delay = JSON.parse( event.content )[ "delay" ];
            invoice_to_pay = JSON.parse( event.content )[ "invoice" ];
            if ( !isValidInvoice( invoice_to_pay ) ) throw( "invalid invoice" );
            if ( typeof delay !== "number" || delay < 0 || delay > 5000 ) throw( "invalid delay" );
            var hash = getInvoicePmthash( invoice_to_pay );
            var amt = getInvoiceAmount( invoice_to_pay );
            var my_fee = Math.floor( ( ( ( amt * 1000 ) * ppm_fee ) / 1_000_000 ) + ( base_fee * 1000 ) );
            var new_amt_msats = ( amt * 1000 ) + my_fee;
            // var new_amount_sats = Number( ( new_amt_msats / 1000 ).toFixed( 3 ) )
            // console.log( 'new invoice amount in sats:', new_amount_sats );
            var min_expiry = getInvoiceHardExpiry( invoice_to_pay );
            min_expiry = min_expiry + 100;
            if ( min_expiry < 240 ) min_expiry = 240;
            var hodl_invoice = await getHodlInvoice( new_amt_msats, hash, min_expiry );
            var msg = JSON.stringify({
                version: 2,
                proxied_invoice: hodl_invoice,
            });
            var emsg = await super_nostr.alt_encrypt( privkey, event.pubkey, msg );
            var reply = await super_nostr.prepEvent( privkey, emsg, 4, [ [ "p", event.pubkey ] ] );
            super_nostr.sendEvent( reply, relays[ 0 ] );
            var status = await checkInvoiceStatus( hash );
            if ( status !== "ACCEPTED" ) {
                cancelHoldInvoice( hash );
                return console.log( 'error:', status );
            }
            var pending_htlc_expiry = await getPendingHTLCExpiry( hash );
            var blockheight = await getBlockheight();
            var blocks_til_invoice_that_pays_me_expires = pending_htlc_expiry - blockheight;
            if ( blocks_til_invoice_that_pays_me_expires - 2 < 0 ) {
                cancelHoldInvoice( hash );
                return console.log( 'error, there is not enough time to pay the recipient and be sure you yourself will get paid' );
            }
            var max_outgoing_fee = my_fee - 1000;
            if ( max_outgoing_fee < 1 ) {
                cancelHoldInvoice( hash );
                return console.log( 'error, the sender is not paying you a sufficient fee' );
            }
            try {
                var response_from_node = await payInvoice( invoice_to_pay, blocks_til_invoice_that_pays_me_expires, max_outgoing_fee );
                if ( response_from_node.startsWith( "error" ) ) throw( response_from_node );
                var preimage_in_base64 = response_from_node;
                var preimage_in_hex = Buffer.from( preimage_in_base64, "base64" ).toString( 'hex' );
                console.log( 'waiting for this delay before settling:', delay );
                setTimeout( () => {
                    console.log( 'delay is done! time to settle' );
                    settleHoldInvoice( preimage_in_hex );
                }, delay );
            } catch ( e ) {
                cancelHoldInvoice( hash );
                return console.log( 'error:', e );
            }
        } catch ( e ) {return;}
    }
    var connection = await super_nostr.newPermanentConnection( relays[ 0 ], listenFunction, handleFunction );
    //advertise service
    console.log( connection );
    setTimeout( async () => {
        var ad = JSON.stringify({
            version: 2,
            base_fee,
            ppm_fee,
        });
        var event = await super_nostr.prepEvent( my_nostr_keys[ 0 ], ad, 15061 );
        var event_id = await super_nostr.sendEvent( event, super_nostr.sockets[ connection ].socket );
        console.log( 'ad sent', event_id );
    }, 1000 );
    await super_nostr.waitSomeSeconds( 300 );
    keyLooper();
}
keyLooper();
