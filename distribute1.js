const CONTRACT_ADDRESS = "0x8d4b55f27c7DE3ee38f0fE47c4C3626DCB93DA9E";
const RPC_URL = "https://rpc.hyperliquid.xyz/evm";

const ABI = [
  "function totalRaised() view returns (uint256)",
  "function getContributors() view returns (address[] memory, uint256[] memory)"
];

const TOKEN_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function transferFrom(address from, address to, uint256 value) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)"
];


const DISTRIBUTOR_ABI = [
  "function distribute(address token, address[] recipients, uint256[] amounts) external"
];

const DISTRIBUTOR_ADDRESS = "0x005b7d0F26ad8E2A45b833318748526e3Be56f79";

let providerRead = new ethers.providers.JsonRpcProvider(RPC_URL);
let contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, providerRead);

let allContributors = [];
let signer;
let userAddress = "";
let tokenContract;
let distributorContract;
let isDistributing = false;

// Load contributors from view function
async function loadContributorEvents() {
  try {
    const raised = await contract.totalRaised();
    const raisedFormatted = ethers.utils.formatEther(raised);
    document.getElementById("totalRaised").textContent = Number(raisedFormatted).toFixed(4);

    const [addresses, amounts] = await contract.getContributors();

    allContributors = await Promise.all(addresses.map(async (addr, i) => {
      const amount = parseFloat(ethers.utils.formatEther(amounts[i])).toFixed(4);
      const timestamp = await getLastContributionTimestampFromHyperscan(addr);
      return {
        index: i + 1,
        address: addr,
        amount,
        timestamp
      };
    }));

    document.getElementById("totalContributors").textContent = allContributors.length.toString();
    renderTable(allContributors);
    updatePreview();
  } catch (err) {
    console.error("Error loading contributors:", err);
    alert("Failed to load contributor data: " + err.message);
  }
}

// Fetch last successful native contribution using Hyperscan
async function getLastContributionTimestampFromHyperscan(address) {
  try {
    const url = `https://www.hyperscan.com/api/v2/addresses/${address}/transactions?filter=from`;
    const res = await fetch(url);
    const data = await res.json();
    const txs = data.items || [];
    const tx = txs.find(
      (tx) =>
        tx.to?.hash?.toLowerCase() === CONTRACT_ADDRESS.toLowerCase() &&
        tx.result === "success" &&
        tx.value && BigInt(tx.value) > 0n &&
        tx.decoded_input?.method_call === "contribute()"
    );
    if (tx && tx.timestamp) {
      const date = new Date(tx.timestamp);
      return date.toLocaleString();
    }
    return "N/A";
  } catch (err) {
    console.error("Timestamp fetch error:", err);
    return "N/A";
  }
}

// Render table
function renderTable(data) {
  const tbody = document.querySelector("#contributorTable tbody");
  tbody.innerHTML = "";

  data.forEach(entry => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${entry.index}</td>
      <td>${entry.address}</td>
      <td>${entry.amount}</td>
      <td>${entry.timestamp}</td>
      <td><button onclick="sendTo('${entry.address}', '${entry.amount}')">Send</button></td>
    `;
    tbody.appendChild(row);
  });
}

// Update preview token
function updatePreview() {
  const rate = parseFloat(document.getElementById("rate").value);
  const previewTable = document.querySelector("#previewTable tbody");
  previewTable.innerHTML = "";

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
    previewTable.appendChild(row);
  });
}

// Search filter
document.getElementById("rate").addEventListener("input", updatePreview);
document.getElementById("search").addEventListener("input", (e) => {
  const keyword = e.target.value.toLowerCase();
  const filtered = allContributors.filter(c => c.address.toLowerCase().includes(keyword));
  renderTable(filtered);
});

// CSV export
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
};

// Connect Wallet
document.getElementById("connectBtn").addEventListener("click", async () => {
  if (typeof window.ethereum !== "undefined") {
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      signer = provider.getSigner();
      userAddress = await signer.getAddress();

      const network = await provider.getNetwork();
      if (network.chainId !== 999) {
        alert("Please switch to HyperEVM network (Chain ID 999)." );
        return;
      }

      document.getElementById("walletAddress").innerText =
        userAddress.slice(0, 6) + "..." + userAddress.slice(-4);
    } catch (err) {
      console.error("Failed to connect wallet:", err);
      alert("Wallet connection failed.");
    }
  } else {
    alert("Please install MetaMask to continue.");
  }
});

// Send token to one wallet
window.sendTo = async (address, amount) => {
  const tokenAddress = document.getElementById("tokenAddress").value.trim();
  const decimals = parseInt(document.getElementById("decimals").value);
  const rate = parseFloat(document.getElementById("rate").value);

  if (!signer) return alert("Connect wallet first.");
  if (!ethers.utils.isAddress(tokenAddress)) return alert("Invalid token address");
  if (!ethers.utils.isAddress(address)) return alert("Invalid recipient address");
  if (isNaN(rate) || rate <= 0) return alert("Invalid rate");
  if (isNaN(decimals) || decimals < 0) return alert("Invalid decimals");

  tokenContract = new ethers.Contract(tokenAddress, TOKEN_ABI, signer);
  const tokenAmount = ethers.utils.parseUnits((parseFloat(amount) * rate).toString(), decimals);

  try {
    const tx = await tokenContract.transfer(address, tokenAmount);
    alert(`Sent: ${tx.hash}`);
    await tx.wait();
    alert("Confirmed!");
  } catch (err) {
    console.error("Send error:", err);
    alert("Send failed");
  }
};

// Distribute tokens to all contributors
async function distributeAllWithContract() {
  if (!signer) {
    alert("Please connect wallet first.");
    return;
  }

  try {
    const tokenAddress = document.getElementById("tokenAddress").value;
    const decimals = parseInt(document.getElementById("decimals").value);
    const rate = parseFloat(document.getElementById("rate").value);

    const distributorContract = new ethers.Contract(DISTRIBUTOR_ADDRESS, DISTRIBUTOR_ABI, signer);
    const tokenContract = new ethers.Contract(tokenAddress, TOKEN_ABI, signer);

    const recipients = [];
    const amounts = [];
    let total = ethers.BigNumber.from("0");

    for (const entry of allContributors) {
      const amt = ethers.utils.parseUnits((parseFloat(entry.amount) * rate).toString(), decimals);
      recipients.push(entry.address);
      amounts.push(amt);
      total = total.add(amt);
    }

    if (recipients.length === 0) {
      alert("No contributors to distribute to.");
      return;
    }

    console.log("Approving total:", ethers.utils.formatUnits(total, decimals));

    // Approve tokens to distributor contract
    const allowance = await tokenContract.allowance(await signer.getAddress(), DISTRIBUTOR_ADDRESS);
    if (allowance.lt(total)) {
      const approveTx = await tokenContract.approve(DISTRIBUTOR_ADDRESS, total);
      await approveTx.wait();
      console.log("Approval successful.");
    } else {
      console.log("Already approved enough tokens.");
    }

    // Call distribute
    const tx = await distributorContract.distribute(tokenAddress, recipients, amounts);
    alert(`Batch sent! TX: ${tx.hash}`);
    await tx.wait();
    alert("All tokens distributed via smart contract!");
  } catch (error) {
    console.error("Distribution failed:", error);
    alert(`Error: ${error.reason || error.message}`);
  }
}

// Auto run
window.addEventListener("DOMContentLoaded", () => {
  loadContributorEvents();
});
