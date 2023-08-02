import { Keyring } from '@polkadot/api';
import type { KeyringPair } from '@polkadot/keyring/types';
import { hexStripPrefix, u8aToHex } from '@polkadot/util'
import { cryptoWaitReady, mnemonicToLegacySeed, hdEthereum } from '@polkadot/util-crypto';
import { 
  polkadot, 
  moonbeam, 
  polkadotAssetHub, 
  usdt, 
  dot 
} from '@moonbeam-network/xcm-config';
import { Sdk, TransferData } from '@moonbeam-network/xcm-sdk';
import { ethers } from 'ethers';
import RouterABI from './RouterABI.json' assert { type: "json" };; 
import { setTimeout } from 'node:timers/promises';

function encodePath(path: string[]): string {
  let encoded = '0x'
  for (let i = 0; i < path.length; i++) {
    // 20 byte encoding of the address
    encoded += path[i].slice(2)
  }

  return encoded.toLowerCase()
}

export async function getSigners(phrase: string) : Promise<{ ethersSigner: ethers.Wallet; polkadotSigner: KeyringPair; }> {
  await cryptoWaitReady();
  
  // Polkadot Signer
  const keyring = new Keyring({
    ss58Format: polkadot.ss58Format,
    type: 'sr25519',
  });
  const polkadotSigner = keyring.createFromUri(phrase);

  // ETH Signer
  const derivePath = "m/44'/60'/0'/0/0";
  const seed = mnemonicToLegacySeed(phrase, '', false, 64);
  const derived = hdEthereum(seed, derivePath);
  const privateKey = hexStripPrefix(u8aToHex(derived.secretKey))

  const provider = new ethers.providers.WebSocketProvider(moonbeam.ws, {
    chainId: moonbeam.id,
    name: moonbeam.name,
  });
  const ethersSigner = new ethers.Wallet(privateKey, provider);
  return {
    ethersSigner,
    polkadotSigner
  }
}

export function logBalances(data: TransferData): void {
  console.log(
    `Balance on ${data.source.chain.name} ${data.source.balance.toDecimal()} ${
      data.source.balance.symbol
    }`,
  );
  console.log(
    `Balance on ${
      data.destination.chain.name
    } ${data.destination.balance.toDecimal()} ${
      data.destination.balance.symbol
    }`,
  );
}

export function logTxDetails(data: TransferData): void {
  console.log(
    `\nYou can send min: ${data.min.toDecimal()} ${
      data.min.symbol
    } and max: ${data.max.toDecimal()} ${data.max.symbol} from ${
      data.source.chain.name
    } to ${
      data.destination.chain.name
    }. You will pay ${data.source.fee.toDecimal()} ${
      data.source.fee.symbol
    } fee on ${
      data.source.chain.name
    } and ${data.destination.fee.toDecimal()} ${
      data.destination.fee.symbol
    } fee on ${data.destination.chain.name}.`,
  );
}

async function fromAssetHub(ethersSigner: ethers.Wallet, polkadotSigner: KeyringPair, asset: any, amount: number) {
  const data = await Sdk().getTransferData({
    sourceKeyOrChain: polkadotAssetHub,
    keyOrAsset: asset,
    sourceAddress: polkadotSigner.address,
    
    destinationKeyOrChain: moonbeam,
    destinationAddress: ethersSigner.address,
    
    polkadotSigner,
    ethersSigner
  });
  logBalances(data);
  logTxDetails(data);

  console.log(`Sending from ${data.source.chain.name} amount: ${amount}`);
  const hash = await data.transfer(amount);
  console.log(`${data.source.chain.name} tx hash: ${hash}`);
}

async function fromMoonbeam(ethersSigner: ethers.Wallet, polkadotSigner: KeyringPair, asset: any, amount: number) {
  const data = await Sdk().getTransferData({
    sourceKeyOrChain: moonbeam,
    keyOrAsset: asset,
    sourceAddress: ethersSigner.address,
    
    destinationKeyOrChain: polkadotAssetHub,
    destinationAddress: polkadotSigner.address,
    
    polkadotSigner,
    ethersSigner
  });
  logBalances(data);
  logTxDetails(data);

  console.log(`Sending from ${data.source.chain.name} amount: ${amount}`);

  const hash = await data.transfer(amount);

  console.log(`${data.source.chain.name} tx hash: ${hash}`);
}

async function swapOnMoonbeam(ethersSigner: ethers.Wallet, inputWei: string, minOutputWei: string, token0: string, token1: string) {
  const pulsarRouter = new ethers.Contract('0xe6d0ED3759709b743707DcfeCAe39BC180C981fe', RouterABI, ethersSigner)
  await (await pulsarRouter.exactInput({
    amountIn: inputWei,
    amountOutMinimum: minOutputWei,
    path: encodePath([
      token0,
      token1
    ]),
    recipient: ethersSigner.address,
    deadline: Math.floor(Date.now() / 1000) + 60 * 20,
  })).wait()
}

async function main() {
  console.warn = () => null;

  const phrase = 'enter phrase here';

  const { ethersSigner, polkadotSigner } = await getSigners(phrase);
  console.log('ETH Address', ethersSigner.address);
  console.log('Polkadot Address', polkadotSigner.address);
  console.log('\n');

  console.log('Transfering from Asset Hub to Moonbeam');
  await fromAssetHub(ethersSigner, polkadotSigner, usdt, 15)
  await setTimeout(20000)
  
  console.log('Swapping USDT to DOT on StellaSwap');
  await swapOnMoonbeam(ethersSigner, ethers.utils.parseUnits('15', 6).toString(), ethers.utils.parseUnits('2', 10).toString(), '0xffffffffea09fb06d082fd1275cd48b191cbcd1d', '0xffffffff1fcacbd218edc0eba20fc2308c778080');
  await setTimeout(20000)
  
  console.log('Sending DOT to Asset Hub');
  await fromMoonbeam(ethersSigner, polkadotSigner, dot, 1)
  
}

main()
  .then(() => console.log('done!'))
  .catch(console.error)
  .finally(() => process.exit());
