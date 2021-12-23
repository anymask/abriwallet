import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Card from '../../Card/Card'
import TESSERACT_ICON from '../../../../../resources/tesseract.svg'
import { useToasts } from '../../../../../hooks/toasts'
import TesseractVaultABI from '../../../../../consts/TesseractVaultABI'
import { Contract, getDefaultProvider, constants } from 'ethers'
import { Interface, parseUnits } from 'ethers/lib/utils'
import networks from '../../../../../consts/networks'
import ERC20ABI from 'adex-protocol-eth/abi/ERC20.json'

const VAULTS = [
    ['tvUSDC', '0x57bDbb788d0F39aEAbe66774436c19196653C3F2', 'https://polygonscan.com/token/images/centre-usdc_32.png'],
    ['tvDAI', '0x4c8C6379b7cd039C892ab179846CD30a1A52b125', 'https://polygonscan.com/token/images/mcdDai_32.png'],
    ['tvWBTC', '0x6962785c731e812073948a1f5E181cf83274D7c6', 'https://polygonscan.com/token/images/wBTC_32.png'],
    ['tvWETH', '0x3d44F03a04b08863cc8825384f834dfb97466b9B', 'https://polygonscan.com/token/images/wETH_32.png'],
    ['tvWMATIC', '0xE11678341625cD88Bb25544e39B2c62CeDcC83f1', 'https://polygonscan.com/token/images/wMatic_32.png'],
]

const TESR_API_ENDPOINT = 'https://prom.tesr.finance/api/v1'

const ERC20Interface = new Interface(ERC20ABI)
const TesseractVaultInterface = new Interface(TesseractVaultABI)

const TesseractCard = ({ networkId, accountId, tokens, addRequest }) => {
    const { addToast } = useToasts()

    const network = networks.find(({ id }) => id === networkId)
    const provider = useMemo(() => getDefaultProvider(network.rpc), [network])
    const disabled = useMemo(() => networkId !== 'polygon', [networkId])
    const currentNetwork = useRef(networkId)
    const [loading, setLoading] = useState(true)

    const addRequestTxn = (id, txn, extraGas = 0) => addRequest({ id, type: 'eth_sendTransaction', chainId: network.chainId, account: accountId, txn, extraGas })

    const [tokensItems, setTokensItems] = useState([])
    const [details, setDetails] = useState([])

    const onTokenSelect = useCallback(address => {
        const selectedToken = tokensItems.find(t => t.value === address)
        if (selectedToken) setDetails([
            ['Annual Percentage Yield (APY)', `${selectedToken.apy}%`],
            ['Lock', 'No Lock'],
            ['Type', 'Variable Rate'],
        ])
    }, [tokensItems])

    const toTokensItems = useCallback((type, vaults) => {
        return vaults.map(({ vaultAddress, token, tToken, icon, apy }) => {
            const { address, symbol, decimals } = type === 'deposit' ? token : tToken
            const portfolioToken = tokens.find(t => t.address.toLowerCase() === address.toLowerCase())
            return {
                type,
                vaultAddress,
                address,
                symbol,
                decimals,
                icon,
                apy,
                label: `${symbol} (${apy}% APY)`,
                value: address,
                balance: portfolioToken ? portfolioToken.balance : 0,
                balanceRaw: portfolioToken ? portfolioToken.balanceRaw : '0',
            }
        })
    }, [tokens])

    const fetchVaultAPY = useCallback(async ticker => {
        try {
            const response = await fetch(`${TESR_API_ENDPOINT}/query?query=rate(price{ticker="${ticker}", version="0.4.3.1"}[24h])*60*60*24*365`)
            const { data, status } = await response.json()
            if (!data || status !== 'success' || !data.result.length) return 0
            return (data.result[0]?.value[1] * 100).toFixed(2)
        } catch(e) {
            console.error(e)
            addToast(`Failed to fetch ${ticker} Vault APY`, { error: true })
        }
    }, [addToast])

    const fetchVaults = useCallback(async () => {
        const vaults = await Promise.all(VAULTS.map(async ([ticker, address, icon]) => {
            try {
                const tesseractVaultContract = new Contract(address, TesseractVaultABI, provider)
                const tokenAddress = await tesseractVaultContract.token()
                
                const tokenContract = new Contract(tokenAddress, ERC20ABI, provider)
                const [symbol, decimals] = await Promise.all([
                    await tokenContract.symbol(),
                    await tokenContract.decimals()
                ])

                const apy = await fetchVaultAPY(ticker)

                return {
                    vaultAddress: address,
                    token: {
                        address: tokenAddress,
                        decimals,
                        symbol,
                    },
                    tToken: {
                        address,
                        decimals,
                        symbol: `tv${symbol}`,
                    },
                    icon,
                    apy
                }
            } catch(e) {
                console.error(e);
                addToast('Fetch Tesseract Vaults: ' + e.message || e, { error: true })
            }
        }))

        const depositTokenItems = toTokensItems('deposit', vaults)
        const withdrawTokenItems = toTokensItems('withdraw', vaults)

        if (networkId !== currentNetwork.current) return

        setTokensItems([
            ...depositTokenItems,
            ...withdrawTokenItems
        ])
    }, [networkId, fetchVaultAPY, provider, toTokensItems, addToast])

    const approveToken = async (vaultAddress, tokenAddress, bigNumberHexAmount) => {
        try {
            const tokenContract = new Contract(tokenAddress, ERC20Interface, provider)
            const allowance = await tokenContract.allowance(accountId, vaultAddress)

            if (allowance.lt(bigNumberHexAmount)) {
                addRequestTxn(`tesseract_vault_approve_${Date.now()}`, {
                    to: tokenAddress,
                    value: '0x0',
                    data: ERC20Interface.encodeFunctionData('approve', [vaultAddress, bigNumberHexAmount])
                })
            }
        } catch(e) {
            console.error(e)
            addToast(`Tesseract Approve Error: ${e.message || e}`, { error: true })
        }
    }

    const onValidate = async (type, value, amount) => {
        const item = tokensItems.find(t => t.type === type.toLowerCase() && t.value === value)
        if (!item) return

        const { vaultAddress, decimals } = item
        const bigNumberAmount = parseUnits(amount.toString(), decimals)

        if (type === 'Deposit') {
            await approveToken(vaultAddress, item.value, constants.MaxUint256)

            try {
                addRequestTxn(`tesseract_vault_deposit_${Date.now()}`, {
                    to: vaultAddress,
                    value: '0x0',
                    data: TesseractVaultInterface.encodeFunctionData('deposit', [bigNumberAmount.toHexString(), accountId])
                })
            } catch(e) {
                console.error(e)
                addToast(`Tesseract Deposit Error: ${e.message || e}`, { error: true })
            }
        } else if (type === 'Withdraw') {
            try {
                addRequestTxn(`tesseract_vault_withdraw_${Date.now()}`, {
                    to: vaultAddress,
                    value: '0x0',
                    data: TesseractVaultInterface.encodeFunctionData('withdraw', [bigNumberAmount, accountId])
                })
            } catch(e) {
                console.error(e)
                addToast(`Tesseract Withdraw Error: ${e.message || e}`, { error: true })
            }
        }
    }

    useEffect(() => {
        async function loadVaults() {
            !disabled && await fetchVaults()
            setLoading(false)
        }
        loadVaults()
    }, [disabled, fetchVaults])

    useEffect(() => {
        currentNetwork.current = networkId
        setLoading(true)
    }, [networkId])

    return (
        <Card
            loading={loading}
            unavailable={disabled}
            icon={TESSERACT_ICON}
            tokensItems={tokensItems}
            details={details}
            onTokenSelect={onTokenSelect}
            onValidate={onValidate}
        />
    )
}

export default TesseractCard