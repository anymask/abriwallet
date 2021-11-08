//import { GrInspect } from 'react-icons/gr'
// GiObservatory is also interesting
import { GiTakeMyMoney, GiSpectacles } from 'react-icons/gi'
import { FaSignature, FaTimes } from 'react-icons/fa'
import { getTransactionSummary, getBundleShortSummary } from '../../lib/humanReadableTransactions'
import './SendTransaction.css'
import { Loading } from '../common'
import { useEffect, useState } from 'react'

// @TODO get rid of these, should be in the SignTransaction component
import fetch from 'node-fetch'
import { Bundle } from 'adex-protocol-eth/js'
import { getDefaultProvider } from 'ethers'
import { useHistory } from 'react-router'
import { useToasts } from '../../hooks/toasts'
import { getWallet } from '../../lib/getWallet'
import accountPresets from '../../consts/accountPresets'

const SPEEDS = ['slow', 'medium', 'fast', 'ape']
const DEFAULT_SPEED = 'fast'

function notifyUser (bundle) {
  if (window.Notification && Notification.permission !== 'denied') {
    Notification.requestPermission(status => {  // status is "granted", if accepted by user
      if (status !== 'granted') return
       /*var n = */new Notification('Ambire Wallet: new transaction request', {
        body: `${getBundleShortSummary(bundle)}`,
        requireInteraction: true
        //icon: '/path/to/icon.png' // optional
      })
    })
  }
}

function toBundleTxn({ to, value, data }) {
  return [to, value || '0x0', data || '0x']
}

function makeBundle(account, networkId, requests) {
  const bundle = new Bundle({
    network: networkId,
    identity: account.id,
    txns: requests.map(({ txn }) => toBundleTxn(txn)),
    signer: account.signer
  })
  bundle.requestIds = requests.map(x => x.id)
  return bundle
}

export default function SendTransaction ({ accounts, network, selectedAcc, requests, resolveMany, relayerURL }) {
  const [estimation, setEstimation] = useState(null)
  const [signingInProgress, setSigningInProgress] = useState(false)
  const history = useHistory()
  const { addToast } = useToasts()

  // Also filtered in App.js, but better safe than sorry here
  const eligibleRequests = requests
    .filter(({ type, chainId, account, txn }) =>
      type === 'eth_sendTransaction'
      && chainId === network.chainId
      && account === selectedAcc
      && txn && (!txn.from || txn.from.toLowerCase() === selectedAcc.toLowerCase())
    )
  useEffect(() => {
    if (estimation) setEstimation(null)
    if (!eligibleRequests.length) return
    // Notify the user with the latest bundle
    notifyUser(bundle)

    // get latest estimation
    const estimatePromise = relayerURL
      ? bundle.estimate({ relayerURL, fetch })
      : bundle.estimateNoRelayer({ provider: getDefaultProvider(network.rpc) })
    estimatePromise
      .then(estimation => {
        estimation.selectedFee = {
          speed: DEFAULT_SPEED,
          multiplier: 1,
          token: { symbol: network.nativeAssetSymbol }
        }
        if (estimation.remainingFeeTokenBalances) {
          const eligibleToken = estimation.remainingFeeTokenBalances
            .find(token => isTokenEligible(token, estimation))
          if (!eligibleToken) {
            estimation.success = false
            estimation.message = `Insufficient balance for the fee. Accepted tokens: ${estimation.remainingFeeTokenBalances.map(x => x.symbol).join(', ')}`
          }
          // If there's no eligibleToken, set it to the first one cause it looks more user friendly (it's the preferred one, usually a stablecoin)
          estimation.selectedFee.token = eligibleToken || estimation.remainingFeeTokenBalances[0]
        }
        setEstimation(estimation)
      })
      .catch(e => {
        addToast(`Estimation error: ${e.message || e}`, { error: true })
        console.log('estimation error', e)
      })
    }, [eligibleRequests.length])

  if (!selectedAcc) return (<h3 className='error'>No selected account</h3>)

  const account = accounts.find(x => x.id === selectedAcc)
  if (!account) throw new Error('internal: account does not exist')

  const bundle = makeBundle(account, network.id, eligibleRequests)

  const approveTxnImpl = async () => {
    if (!estimation) return

    const requestIds = bundle.requestIds
    const feeTxn = [accountPresets.feeCollector, '0x'+Math.round(estimation.feeInNative.ape*1e18).toString(16), '0x']
    const finalBundle = new Bundle({
      ...bundle,
      txns: [...bundle.txns, feeTxn]
    })

    const provider = getDefaultProvider(network.rpc)
    await finalBundle.getNonce(provider)

    finalBundle.gasLimit = estimation.gasLimit

    const wallet = getWallet({
      signer: finalBundle.signer,
      signerExtra: account.signerExtra
    })
    // @TODO relayerless mode

    await finalBundle.sign(wallet)
    const bundleResult = await finalBundle.submit({ relayerURL, fetch })
    resolveMany(requestIds, { success: bundleResult.success, result: bundleResult.txId, message: bundleResult.message })

    return bundleResult
  }

  const approveTxn = () => {
    if (signingInProgress) return
    setSigningInProgress(true)

    const explorerUrl = network.explorerUrl
    approveTxnImpl()
      .then(bundleResult => {
        if (bundleResult.success) addToast((
          <span>Transaction signed and sent successfully!
            &nbsp;<a href={explorerUrl+'/tx/'+bundleResult.txId} target='_blank'>View on block explorer.</a>
          </span>))
        else addToast(`Transaction error: ${bundleResult.message || 'unspecified error'}`, { error: true })

        history.goBack()
      })
      .catch(e => {
        console.error(e)
        addToast(`Signing error: ${e.message || e}`, { error: true })
      })
      .then(() => setSigningInProgress(false))

  }

  const rejectButton = (
      <button className='rejectTxn' onClick={() => {
          resolveMany(requests.map(x => x.id), { message: 'rejected' })
          history.goBack()
      }}>Reject</button>
  )

  const actionable =
      (estimation && !estimation.success)
      ? (<>
          <h2 className='error'> The current transaction cannot be broadcasted because it will fail: {estimation.message}</h2>
          {rejectButton}
          </>)
      : (<div>
          {rejectButton}
          <button className='approveTxn' disabled={!estimation || signingInProgress} onClick={approveTxn}>
            {signingInProgress ? (<><Loading/>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Signing...</>) : (<>Sign and send</>)}
          </button>
      </div>)

  return (<div id="sendTransaction">
      <h2>Pending transaction</h2>
      <div className="panelHolder">
          <div className="panel">
              <div className="heading">
                      <div className="title">
                          <GiSpectacles size={35}/>
                          Transaction summary
                      </div>
                      <ul>
                          {bundle.txns.map((txn, i) => {
                            const isFirstFailing = estimation && !estimation.success && estimation.firstFailing === i
                            return (
                              <li key={txn} className={isFirstFailing ? 'firstFailing' : ''}>
                                  {getTransactionSummary(txn, bundle)}
                                  {isFirstFailing ? (<div><b>This is the first failing transaction.</b></div>) : (<></>)}
                                  <a onClick={() => resolveMany([eligibleRequests[i].id], { message: 'rejected' })}><FaTimes></FaTimes></a>
                              </li>
                          )})}
                      </ul>
                      <span>
                          <b>NOTE:</b> Transaction batching is enabled, you're signing {eligibleRequests.length} transactions at once. You can add more transactions to this batch by interacting with a connected dApp right now.
                      </span>
              </div>
          </div>
          <div className="secondaryPanel">
              <div className="panel feePanel">
                  <div className="heading">
                          <div className="title">
                              <GiTakeMyMoney size={35}/>
                              Fee
                          </div>
                          <FeeSelector estimation={estimation} setEstimation={setEstimation} network={network}></FeeSelector>
                  </div>
              </div>
              <div className="panel">
                  <div className="heading">
                      <div className="title">
                          <FaSignature size={35}/>
                          Sign
                      </div>
                  </div>
                  {actionable}
              </div>
          </div>
      </div>
  </div>)
}

function FeeSelector ({ estimation, network, setEstimation }) {
  if (!estimation) return (<Loading/>)
  if (!estimation.feeInNative) return (<></>)
  const { nativeAssetSymbol } = network
  const tokens = estimation.remainingFeeTokenBalances || ({ symbol: nativeAssetSymbol, decimals: 18 })
  const onFeeCurrencyChange = e => {
    const token = tokens.find(({ symbol }) => symbol === e.target.value)
    setEstimation({ ...estimation, selectedFee: { ...estimation.selectedFee, token } })
  }
  const feeCurrencySelect = estimation.feeInUSD ? (
    <select defaultValue={estimation.selectedFee.token.symbol} onChange={onFeeCurrencyChange}>
      {tokens.map(token => 
        (<option
          disabled={!isTokenEligible(token, estimation)}
          key={token.symbol}>
            {token.symbol}
          </option>
        )
      )}
    </select>
  ) : (<select disabled defaultValue={nativeAssetSymbol}>
    <option>{nativeAssetSymbol}</option>
  </select>)

  const stableSelected = estimation.selectedFee.token.isStable
  const feeAmountSelectors = SPEEDS.map(speed => (
    <div 
      key={speed}
      className={estimation.selectedFee.speed === speed ? 'feeSquare selected' : 'feeSquare'}
      onClick={() => setEstimation({ ...estimation, selectedFee: { ...estimation.selectedFee, speed } })}
    >
      <div className='speed'>{speed}</div>
      {stableSelected
        ? '$'+(estimation.feeInUSD[speed] * estimation.selectedFee.multiplier)
        : (estimation.feeInNative[speed] * estimation.selectedFee.multiplier)+' '+nativeAssetSymbol
      }
    </div>
  ))

  return (<>
    <span style={{ marginTop: '1em' }}>Fee currency</span>
    {feeCurrencySelect}
    <div className='feeAmountSelectors'>
      {feeAmountSelectors}
    </div>
    {!estimation.feeInUSD ? (<span><b>WARNING:</b> Paying fees in tokens other than {nativeAssetSymbol} is unavailable because you are not connected to a relayer.</span>) : (<></>)}
  </>)
}

// helpers
function isTokenEligible (token, estimation) {
  const min = token.isStable ? estimation.feeInUSD.fast : estimation.feeInNative.fast
  return parseInt(token.balance) / Math.pow(10, token.decimals) > min
}