const net = require('net');
const argparse = require('argparse');
const logger = require('simple-node-logger').createSimpleLogger();

const OnvifServer = require('./src/onvif-server');
const { readAndCheckConfig } = require('./src/config-tools');


const parser = new argparse.ArgumentParser({
    description: 'Virtual RTSP to ONVIF proxy'
});

function createTcpProxy(logger, sourcePort, destinationAddress, destinationPort) {
    const server = net.createServer((sourceSocket) => {
        const sourceAddress = `${sourceSocket.remoteAddress}:${sourceSocket.remotePort}`;
        const destination = `${destinationAddress}:${destinationPort}`;
        logger.debug(`PROXY: Client ${sourceAddress} -> ${destination}`);

        const destinationSocket = net.connect(destinationPort, destinationAddress, () => {
            logger.debug(`PROXY: Connected ${sourceAddress} -> ${destination}`);
            sourceSocket.pipe(destinationSocket);
            destinationSocket.pipe(sourceSocket);
        });

        sourceSocket.on('error', (error) => {
            logger.debug(`PROXY: Client error ${sourceAddress} - ${error.message}`);
            destinationSocket.destroy();
        });

        destinationSocket.on('error', (error) => {
            logger.debug(`PROXY: Upstream error ${sourceAddress} -> ${destination} - ${error.message}`);
            sourceSocket.destroy();
        });

        sourceSocket.on('close', () => {
            logger.debug(`PROXY: Client closed ${sourceAddress}`);
            destinationSocket.destroy();
        });

        destinationSocket.on('close', () => {
            logger.debug(`PROXY: Upstream closed ${sourceAddress} -> ${destination}`);
            sourceSocket.destroy();
        });
    });

    server.on('error', (error) => {
        logger.error(`PROXY: Failed to listen on ${sourcePort} - ${error.message}`);
    });

    server.listen(sourcePort, () => {
        logger.info(`PROXY: RTSP listening on 0.0.0.0:${sourcePort}`);
    });

    return server;
}

parser.add_argument('config', { help: 'config filename to use', nargs: '?' });

let args = parser.parse_args();

if (args) {
    if (process.env.DEBUG) {
        logger.setLevel('trace');
    }

    if (!args.config) {
        logger.info('Please specifiy a config filename!');
        return -1;
    }

    let config = readAndCheckConfig(logger, args.config)

    let proxies = {};
    for (let onvifConfig of config.onvif) {

        let server = new OnvifServer(logger, onvifConfig);

        if (server.getHostname()) {

            logger.info('');
            server.startHttpServer();
            server.startDiscovery();
            if (process.env.DEBUG)
                server.enableDebugOutput()

            if (!proxies[onvifConfig.target.hostname])
                proxies[onvifConfig.target.hostname] = {}

            if (onvifConfig.ports.rtsp && onvifConfig.target.ports.rtsp)
                proxies[onvifConfig.target.hostname][onvifConfig.ports.rtsp] = onvifConfig.target.ports.rtsp;
            if (onvifConfig.ports.snapshot && onvifConfig.target.ports.snapshot)
                proxies[onvifConfig.target.hostname][onvifConfig.ports.snapshot] = onvifConfig.target.ports.snapshot;
        } else {
            logger.error(`Failed to find IP address for MAC address ${onvifConfig.mac}`)
            return -1;
        }
    }

    for (let destinationAddress in proxies) {
        for (let sourcePort in proxies[destinationAddress]) {
            logger.info(`PROXY: ${sourcePort} --> ${destinationAddress}:${proxies[destinationAddress][sourcePort]}`);
            createTcpProxy(logger, sourcePort, destinationAddress, proxies[destinationAddress][sourcePort]);
        }
    }

    return 0;
}
