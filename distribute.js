document.addEventListener('DOMContentLoaded', () => {
    const CONTRACT_ADDRESS = "0xa65872aD6C5628952299d66538Ee656eeaB80c3f"; //NativeTokenPresale
    const RPC_URL = "https://rpc.hypurrscan.io"; // IMPORTANT: Update this to your HyperEVM RPC
    const HYPEREVM_CHAIN_ID = 999; // IMPORTANT: Verify your HyperEVM Chain ID

    const ABI = [
      "event ContributionReceived(address indexed contributor, uint amount)",
      "function totalRaised() view returns (uint256)"
    ];

    const TOKEN_ABI = [
      "function transfer(address to, uint256 amount) public returns (bool)",
      "function balanceOf(address owner) view returns (uint256)",
      "function approve(address spender, uint256 amount) external returns (bool)"
    ];

    const DISTRIBUTOR_ABI = [
      "function distribute(address token, address[] recipients, uint256[] amounts) external",
      "function owner() view returns (address)",
      "event TokensAirdropped(address indexed token, address indexed sender, uint256 totalAmount, uint256 recipientCount)"
    ];

    const DISTRIBUTOR_ADDRESS = "0xA902Ee075B3781436A91D708d31483d1b1DEd96C"; // TokenDistribution

    const BATCH_SIZE = 150;
    const BATCH_DELAY_MS = 1500;

    let distributorContract;
    let tokenContract;
    let signer;
    let userAddress = "";
    let allContributors = [];
    let isDistributing = false;

    const providerRead = new ethers.providers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, providerRead);

    const totalRaisedElement = document.getElementById("totalRaised");
    const totalContributorsElement = document.getElementById("totalContributors");
    const contributorTableBody = document.querySelector("#contributorTable tbody");
    const previewTableBody = document.querySelector("#previewTable tbody");
    const rateInput = document.getElementById("rate");
    const searchInput = document.getElementById("search");
    const connectBtn = document.getElementById("connectBtn");
    const walletAddressDisplay = document.getElementById("walletAddress");
    const tokenAddressInput = document.getElementById("tokenAddress");
    const decimalsInput = document.getElementById("decimals");
    const distributeAllBtn = document.getElementById("distributeAllBtn");
    const statusMessageDiv = document.getElementById("statusMessage");

    function showAlert(message, type = 'info') {
        alert(message);
        console.log(`[ALERT - ${type.toUpperCase()}]: ${message}`);
    }

    function showStatus(message, type = 'info') {
        if (statusMessageDiv) {
            statusMessageDiv.innerHTML = message;
            statusMessageDiv.className = `message ${type}`;
            statusMessageDiv.style.display = 'block';
        }
    }

    function hideStatus() {
        if (statusMessageDiv) statusMessageDiv.style.display = 'none';
    }

    async function loadContributorEvents() {
        showStatus("Loading contributor data...", 'info');
        try {
            const raised = await contract.totalRaised();
            const raisedFormatted = ethers.utils.formatEther(raised);
            if (totalRaisedElement) totalRaisedElement.textContent = Number(raisedFormatted).toFixed(4);

            const latestBlock = await providerRead.getBlockNumber();
            const logBatchSize = 1000;
            const fromBlock = 4092523;

            const logs = [];
            for (let start = fromBlock; start <= latestBlock; start += logBatchSize) {
                const end = Math.min(start + logBatchSize - 1, latestBlock);
                try {
                    const batchLogs = await contract.queryFilter("ContributionReceived", start, end);
                    logs.push(...batchLogs);
                    showStatus(`Fetching logs from block ${start} to ${end}. Total fetched: ${logs.length}`, 'info');
                } catch (err) {
                    console.warn(`Failed to fetch logs from block ${start} to ${end}. Skipping batch.`, err);
                    showStatus(`Warning: Failed to fetch some logs. Data might be incomplete.`, 'error');
                }
            }

            const contributorMap = new Map();
            const blockTimestamps = new Map();

            const uniqueBlockNumbers = [...new Set(logs.map(log => log.blockNumber))];
            
            const blockPromises = uniqueBlockNumbers.map(blockNum => providerRead.getBlock(blockNum));
            const blocks = await Promise.all(blockPromises);
            blocks.forEach(block => {
                if (block) blockTimestamps.set(block.number, block.timestamp);
            });

            for (const log of logs) {
                const { contributor, amount } = log.args;
                const timestamp = blockTimestamps.has(log.blockNumber)
                    ? new Date(blockTimestamps.get(log.blockNumber) * 1000).toLocaleString()
                    : 'N/A';

                if (contributorMap.has(contributor)) {
                    const existing = contributorMap.get(contributor);
                    existing.amount = existing.amount.add(amount);
                    existing.timestamp = timestamp;
                } else {
                    contributorMap.set(contributor, {
                        address: contributor,
                        amount: amount,
                        timestamp
                    });
                }
            }

            allContributors = Array.from(contributorMap.values()).map((entry, index) => ({
                index: index + 1,
                address: entry.address,
                amount: parseFloat(ethers.utils.formatEther(entry.amount)).toFixed(4),
                timestamp: entry.timestamp
            }));

            if (totalContributorsElement) totalContributorsElement.textContent = allContributors.length.toString();
            renderTable(allContributors);
            updatePreview();
            showStatus(`Successfully loaded ${allContributors.length} unique contributors.`, 'info');

        } catch (err) {
            console.error("Error loading contributors:", err);
            showAlert("Failed to load contributor events: " + err.message, 'error');
            hideStatus();
        }
    }

    function renderTable(data) {
        if (!contributorTableBody) return;
        contributorTableBody.innerHTML = "";

        data.forEach(entry => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${entry.index}</td>
                <td>${entry.address}</td>
                <td>${entry.amount}</td>
                <td>${entry.timestamp}</td>
                <td><button onclick="sendTo('${entry.address}', '${entry.amount}')" class="send-button">Send</button></td>
            `;
            contributorTableBody.appendChild(row);
        });
    }

    function updatePreview() {
        if (!rateInput || !previewTableBody) return;
        const rate = parseFloat(rateInput.value);
        previewTableBody.innerHTML = "";

        if (isNaN(rate)) return;

        allContributors.forEach((entry) => {
            const tokenAmount = (parseFloat(entry.amount) * rate).toFixed(4);
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${entry.index}</td>
                <td>${entry.address}</td>
                <td>${entry.amount}</td>
                <td>${tokenAmount}</td>
            `;
            previewTableBody.appendChild(row);
        });
    }

    if (rateInput) rateInput.addEventListener("input", updatePreview);
    if (searchInput) searchInput.addEventListener("input", (e) => {
        const keyword = e.target.value.toLowerCase();
        const filtered = allContributors.filter(c => c.address.toLowerCase().includes(keyword));
        renderTable(filtered);
    });

    window.downloadCSV = function () {
        let csv = "No,Address,Contribution,Timestamp\n";
        allContributors.forEach(row => {
            csv += `${row.index},${row.address},${row.amount},${row.timestamp}\n`;
        });

        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "contributors.csv";
        link.click();
        URL.revokeObjectURL(url);
    };

    if (connectBtn) connectBtn.addEventListener("click", async () => {
        if (typeof window.ethereum !== "undefined") {
            try {
                const provider = new ethers.providers.Web3Provider(window.ethereum);
                await provider.send("eth_requestAccounts", []);
                signer = provider.getSigner();
                userAddress = await signer.getAddress();

                const network = await provider.getNetwork();
                if (network.chainId !== HYPEREVM_CHAIN_ID) {
                    showAlert(`Please switch to HyperEVM network (Chain ID ${HYPEREVM_CHAIN_ID}).`, 'error');
                    if (distributeAllBtn) distributeAllBtn.disabled = true;
                    return;
                } else {
                    if (distributeAllBtn) distributeAllBtn.disabled = false;
                }

                if (walletAddressDisplay) walletAddressDisplay.innerText =
                    userAddress.slice(0, 6) + "..." + userAddress.slice(-4);
                
                showStatus(`Wallet connected: ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`, 'info');

            } catch (err) {
                console.error("Failed to connect wallet:", err);
                showAlert("Wallet connection failed.", 'error');
                hideStatus();
            }
        } else {
            showAlert("Please install MetaMask to continue.", 'error');
        }
    });

    window.sendTo = async (address, amountContributionFormatted) => {
        const tokenAddress = tokenAddressInput ? tokenAddressInput.value.trim() : "";
        const decimals = decimalsInput ? parseInt(decimalsInput.value) : NaN;
        const rate = rateInput ? parseFloat(rateInput.value) : NaN;

        if (!signer) return showAlert("Connect wallet first.", 'error');
        if (!ethers.utils.isAddress(tokenAddress)) return showAlert("Invalid token address", 'error');
        if (!ethers.utils.isAddress(address)) return showAlert("Invalid recipient address", 'error');
        if (isNaN(rate) || rate <= 0) return showAlert("Invalid rate", 'error');
        if (isNaN(decimals) || decimals < 0) return showAlert("Invalid decimals", 'error');

        tokenContract = new ethers.Contract(tokenAddress, TOKEN_ABI, signer);

        let tokenAmountRaw;
        try {
            const amountForAirdropFloat = parseFloat(amountContributionFormatted) * rate;
            tokenAmountRaw = ethers.utils.parseUnits(amountForAirdropFloat.toString(), decimals);
        } catch (e) {
            console.error("Error parsing token amount for individual send:", e);
            return showAlert("Error calculating token amount. Check decimals and rate.", 'error');
        }

        try {
            showStatus(`Sending ${ethers.utils.formatUnits(tokenAmountRaw, decimals)} tokens to ${address.slice(0,6)}...${address.slice(-4)}... Confirm in wallet.`, 'info');
            const tx = await tokenContract.transfer(address, tokenAmountRaw);
            showStatus(`Transaction sent! Hash: ${tx.hash}. Waiting for confirmation...`, 'info');
            console.log("Individual Send TX:", tx.hash);

            await tx.wait();
            showStatus("Transaction confirmed!", 'success');
            showAlert("Token transfer confirmed!", 'success');
        } catch (err) {
            console.error("Send error:", err);
            let errMsg = "Token transfer failed.";
            if (err.code === 4001) errMsg = "Transaction denied by user.";
            else if (err.data && err.data.message) errMsg = `Transfer failed: ${err.data.message}`;
            showAlert(errMsg, 'error');
        } finally {
            hideStatus();
        }
    };

    if (distributeAllBtn) distributeAllBtn.addEventListener("click", async () => {
        if (!signer) {
            showAlert("Please connect wallet first.", 'error');
            return;
        }
        if (isDistributing) {
            showAlert("Airdrop process is already running. Please wait.", 'info');
            return;
        }

        const tokenAddress = tokenAddressInput ? tokenAddressInput.value.trim() : "";
        const decimals = decimalsInput ? parseInt(decimalsInput.value) : NaN;
        const rate = rateInput ? parseFloat(rateInput.value) : NaN;

        if (!ethers.utils.isAddress(tokenAddress)) return showAlert("Invalid token address.", 'error');
        if (isNaN(rate) || rate <= 0) return showAlert("Invalid rate.", 'error');
        if (isNaN(decimals) || decimals < 0) return showAlert("Invalid decimals.", 'error');
        if (allContributors.length === 0) return showAlert("No contributors loaded. Load snapshot first.", 'error');

        distributorContract = new ethers.Contract(DISTRIBUTOR_ADDRESS, DISTRIBUTOR_ABI, signer);
        const tokenContractInstance = new ethers.Contract(tokenAddress, TOKEN_ABI, signer); 

        const allRecipients = [];
        const allAmountsRaw = [];
        let totalAmountForApproval = ethers.BigNumber.from("0");

        for (const entry of allContributors) {
            try {
                const amountForAirdropFloat = parseFloat(entry.amount) * rate;
                const amtRaw = ethers.utils.parseUnits(amountForAirdropFloat.toString(), decimals);
                
                allRecipients.push(entry.address);
                allAmountsRaw.push(amtRaw);
                totalAmountForApproval = totalAmountForApproval.add(amtRaw);
            } catch (e) {
                console.error(`Error processing amount for ${entry.address}: ${e.message}`, e);
                showAlert(`Error calculating token amount for ${entry.address}. Check rate and decimals.`, 'error');
                return;
            }
        }

        const confirmStart = confirm(`Are you sure you want to start airdrop to ${allRecipients.length} recipients in batches?\n\n` +
                                     `Total token amount to approve: ${ethers.utils.formatUnits(totalAmountForApproval, decimals)}`);
        if (!confirmStart) {
            showAlert("Airdrop cancelled by user.", 'info');
            return;
        }

        const totalBatches = Math.ceil(allRecipients.length / BATCH_SIZE);
        let successfulBatches = 0;
        let failedBatches = 0;
        isDistributing = true;
        distributeAllBtn.disabled = true;

        try {
            showStatus(`Step 1/2: Approving ${ethers.utils.formatUnits(totalAmountForApproval, decimals)} tokens for Distributor Contract (${DISTRIBUTOR_ADDRESS.slice(0,6)}...). Confirm in your wallet.`, 'info');
            const approveTx = await tokenContractInstance.approve(DISTRIBUTOR_ADDRESS, totalAmountForApproval);
            showStatus(`Approval transaction sent! Hash: ${approveTx.hash}. Waiting for confirmation...`, 'info');
            await approveTx.wait();
            showStatus("Token approval confirmed! Proceeding with airdrop batches...", 'info');
        } catch (err) {
            console.error("Token approval failed:", err);
            let errMsg = "Token approval failed.";
            if (err.code === 4001) errMsg = "Approval denied by user.";
            else if (err.data && err.data.message) errMsg = `Approval failed: ${err.data.message}`;
            showAlert(errMsg, 'error');
            isDistributing = false;
            distributeAllBtn.disabled = false;
            hideStatus();
            return;
        }

        try {
            for (let i = 0; i < allRecipients.length; i += BATCH_SIZE) {
                const batchRecipients = allRecipients.slice(i, i + BATCH_SIZE);
                const batchAmounts = allAmountsRaw.slice(i, i + BATCH_SIZE);
                const currentBatchNum = (i / BATCH_SIZE) + 1;

                showStatus(
                    `Step 2/2: Processing batch ${currentBatchNum} of ${totalBatches} (${batchRecipients.length} recipients). Confirm in your wallet.`,
                    'info'
                );
                console.log(`Sending batch ${currentBatchNum} with ${batchRecipients.length} recipients.`);

                const tx = await distributorContract.distribute(tokenAddress, batchRecipients, batchAmounts);
                showStatus(
                    `Batch ${currentBatchNum} transaction sent! Hash: <a href="${RPC_URL.replace('/evm', '').replace('/api/v2', '')}/tx/${tx.hash}" target="_blank">${tx.hash.slice(0, 6)}...${tx.hash.slice(-4)}</a>. Waiting for confirmation...`,
                    'info'
                );
                console.log(`Batch ${currentBatchNum} Transaction Hash:`, tx.hash);

                const receipt = await tx.wait();

                if (receipt.status === 1) {
                    successfulBatches++;
                    showStatus(
                        `Batch ${currentBatchNum} successful! Confirmed in block ${receipt.blockNumber}. ` +
                        `Successful batches: ${successfulBatches}/${totalBatches}`,
                        'success'
                    );
                    console.log(`Batch ${currentBatchNum} Transaction Receipt:`, receipt);
                } else {
                    failedBatches++;
                    showStatus(
                        `Batch ${currentBatchNum} failed! Transaction reverted. ` +
                        `Failed batches: ${failedBatches}/${totalBatches}. Check console for details.`,
                        'error'
                    );
                    console.error(`Batch ${currentBatchNum} Transaction Reverted:`, receipt);
                }

                if (currentBatchNum < totalBatches) {
                    showStatus(`Batch ${currentBatchNum} complete. Waiting for ${BATCH_DELAY_MS / 1000} seconds before next batch.`, 'info');
                    await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
                }
            }

            if (successfulBatches === totalBatches && failedBatches === 0) {
                showAlert("Airdrop process completed successfully for all batches!", 'success');
            } else {
                showAlert(`Airdrop process completed with some issues: ${successfulBatches} successful, ${failedBatches} failed.`, 'warning');
            }

        } catch (err) {
            console.error("Error during airdrop batching process:", err);
            let errMsg = "Airdrop process interrupted or failed.";
            if (err.code === 4001) errMsg = "Airdrop cancelled by user.";
            else if (err.data && err.data.message) errMsg = `Airdrop failed: ${err.data.message}`;
            showAlert(errMsg, 'error');
        } finally {
            isDistributing = false;
            distributeAllBtn.disabled = false;
            hideStatus();
        }
    });

    window.addEventListener("DOMContentLoaded", () => {
        loadContributorEvents();
        if (totalRaisedElement) totalRaisedElement.textContent = "0.0000";
        if (totalContributorsElement) totalContributorsElement.textContent = "0";
    });
});