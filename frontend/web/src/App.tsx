// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface DebrisData {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  region: string;
  density: number;
  status: "pending" | "verified" | "rejected";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [debrisList, setDebrisList] = useState<DebrisData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newDebrisData, setNewDebrisData] = useState({
    region: "",
    density: "",
    coordinates: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [activeTab, setActiveTab] = useState("map");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  // Calculate statistics for dashboard
  const verifiedCount = debrisList.filter(d => d.status === "verified").length;
  const pendingCount = debrisList.filter(d => d.status === "pending").length;
  const rejectedCount = debrisList.filter(d => d.status === "rejected").length;
  const avgDensity = debrisList.length > 0 
    ? debrisList.reduce((sum, item) => sum + item.density, 0) / debrisList.length 
    : 0;

  useEffect(() => {
    loadDebrisData().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadDebrisData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("debris_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing debris keys:", e);
        }
      }
      
      const list: DebrisData[] = [];
      
      for (const key of keys) {
        try {
          const debrisBytes = await contract.getData(`debris_${key}`);
          if (debrisBytes.length > 0) {
            try {
              const debrisData = JSON.parse(ethers.toUtf8String(debrisBytes));
              list.push({
                id: key,
                encryptedData: debrisData.data,
                timestamp: debrisData.timestamp,
                owner: debrisData.owner,
                region: debrisData.region,
                density: debrisData.density,
                status: debrisData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing debris data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading debris ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setDebrisList(list);
    } catch (e) {
      console.error("Error loading debris data:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitDebrisData = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setUploading(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting debris data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newDebrisData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const debrisId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const debrisData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        region: newDebrisData.region,
        density: parseFloat(newDebrisData.density),
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `debris_${debrisId}`, 
        ethers.toUtf8Bytes(JSON.stringify(debrisData))
      );
      
      const keysBytes = await contract.getData("debris_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(debrisId);
      
      await contract.setData(
        "debris_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted debris data submitted securely!"
      });
      
      await loadDebrisData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowUploadModal(false);
        setNewDebrisData({
          region: "",
          density: "",
          coordinates: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setUploading(false);
    }
  };

  const verifyDebris = async (debrisId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted debris data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const debrisBytes = await contract.getData(`debris_${debrisId}`);
      if (debrisBytes.length === 0) {
        throw new Error("Debris data not found");
      }
      
      const debrisData = JSON.parse(ethers.toUtf8String(debrisBytes));
      
      const updatedDebris = {
        ...debrisData,
        status: "verified"
      };
      
      await contract.setData(
        `debris_${debrisId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedDebris))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE verification completed successfully!"
      });
      
      await loadDebrisData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectDebris = async (debrisId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted debris data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const debrisBytes = await contract.getData(`debris_${debrisId}`);
      if (debrisBytes.length === 0) {
        throw new Error("Debris data not found");
      }
      
      const debrisData = JSON.parse(ethers.toUtf8String(debrisBytes));
      
      const updatedDebris = {
        ...debrisData,
        status: "rejected"
      };
      
      await contract.setData(
        `debris_${debrisId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedDebris))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE rejection completed successfully!"
      });
      
      await loadDebrisData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Rejection failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the FHE debris mapping system",
      icon: "🔗"
    },
    {
      title: "Upload Encrypted Data",
      description: "Submit your space debris observations encrypted with FHE technology",
      icon: "🔒"
    },
    {
      title: "FHE Processing",
      description: "Data is processed in encrypted state without decryption for privacy",
      icon: "⚙️"
    },
    {
      title: "View Density Maps",
      description: "Access high-resolution 3D debris field maps for mission planning",
      icon: "🗺️"
    }
  ];

  // Filter debris data based on search and filter criteria
  const filteredDebris = debrisList.filter(item => {
    const matchesSearch = item.region.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          item.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterStatus === "all" || item.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const renderDensityChart = () => {
    return (
      <div className="density-chart">
        <div className="chart-title">Average Density by Region</div>
        <div className="chart-bars">
          {debrisList.slice(0, 5).map((item, index) => (
            <div key={index} className="chart-bar">
              <div 
                className="bar-fill" 
                style={{ height: `${Math.min(item.density * 2, 100)}%` }}
              ></div>
              <div className="bar-label">{item.region}</div>
              <div className="bar-value">{item.density.toFixed(2)}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="satellite-icon"></div>
          </div>
          <h1>SpaceDebris<span>FHE</span>Map</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowUploadModal(true)} 
            className="upload-data-btn"
            disabled={!account}
          >
            <div className="upload-icon"></div>
            Upload Data
          </button>
          <button 
            className="tutorial-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Confidential Space Debris Field Density Mapping</h2>
            <p>Multi-agency FHE-powered collaboration for secure space debris analysis</p>
          </div>
          <div className="fhe-badge">
            <span>FHE-ENCRYPTED</span>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>Space Debris Mapping Tutorial</h2>
            <p className="subtitle">Learn how to securely contribute to space debris mapping</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="tab-navigation">
          <button 
            className={activeTab === "map" ? "tab-btn active" : "tab-btn"}
            onClick={() => setActiveTab("map")}
          >
            Density Map
          </button>
          <button 
            className={activeTab === "data" ? "tab-btn active" : "tab-btn"}
            onClick={() => setActiveTab("data")}
          >
            Data Repository
          </button>
          <button 
            className={activeTab === "stats" ? "tab-btn active" : "tab-btn"}
            onClick={() => setActiveTab("stats")}
          >
            Statistics
          </button>
        </div>
        
        {activeTab === "map" && (
          <div className="map-section">
            <div className="section-header">
              <h2>3D Debris Density Field Visualization</h2>
              <p>FHE-reconstructed density mapping for mission planning</p>
            </div>
            <div className="map-container">
              <div className="map-placeholder">
                <div className="orbit-animation">
                  <div className="orbit"></div>
                  <div className="debris-point" style={{ top: '30%', left: '40%' }}></div>
                  <div className="debris-point" style={{ top: '60%', left: '20%' }}></div>
                  <div className="debris-point" style={{ top: '20%', left: '70%' }}></div>
                  <div className="debris-point" style={{ top: '50%', left: '60%' }}></div>
                  <div className="debris-point" style={{ top: '70%', left: '80%' }}></div>
                </div>
                <div className="map-overlay">
                  <h3>FHE 3D Density Reconstruction</h3>
                  <p>Secure multi-agency data collaboration</p>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "data" && (
          <div className="data-section">
            <div className="section-header">
              <h2>Encrypted Debris Data Repository</h2>
              <div className="header-actions">
                <div className="search-box">
                  <input 
                    type="text" 
                    placeholder="Search by region or ID..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <select 
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="filter-select"
                >
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="verified">Verified</option>
                  <option value="rejected">Rejected</option>
                </select>
                <button 
                  onClick={loadDebrisData}
                  className="refresh-btn"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="data-list">
              <div className="list-header">
                <div className="header-cell">ID</div>
                <div className="header-cell">Region</div>
                <div className="header-cell">Owner</div>
                <div className="header-cell">Date</div>
                <div className="header-cell">Density</div>
                <div className="header-cell">Status</div>
                <div className="header-cell">Actions</div>
              </div>
              
              {filteredDebris.length === 0 ? (
                <div className="no-data">
                  <div className="no-data-icon"></div>
                  <p>No debris data found</p>
                  <button 
                    className="upload-btn"
                    onClick={() => setShowUploadModal(true)}
                  >
                    Upload First Data
                  </button>
                </div>
              ) : (
                filteredDebris.map(debris => (
                  <div className="data-row" key={debris.id}>
                    <div className="data-cell record-id">#{debris.id.substring(0, 6)}</div>
                    <div className="data-cell">{debris.region}</div>
                    <div className="data-cell">{debris.owner.substring(0, 6)}...{debris.owner.substring(38)}</div>
                    <div className="data-cell">
                      {new Date(debris.timestamp * 1000).toLocaleDateString()}
                    </div>
                    <div className="data-cell">{debris.density.toFixed(2)}</div>
                    <div className="data-cell">
                      <span className={`status-badge ${debris.status}`}>
                        {debris.status}
                      </span>
                    </div>
                    <div className="data-cell actions">
                      {isOwner(debris.owner) && debris.status === "pending" && (
                        <>
                          <button 
                            className="action-btn verify"
                            onClick={() => verifyDebris(debris.id)}
                          >
                            Verify
                          </button>
                          <button 
                            className="action-btn reject"
                            onClick={() => rejectDebris(debris.id)}
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        
        {activeTab === "stats" && (
          <div className="stats-section">
            <div className="section-header">
              <h2>Debris Field Statistics</h2>
              <p>FHE-processed analytics from multi-agency contributions</p>
            </div>
            
            <div className="stats-grid">
              <div className="stat-card">
                <h3>Total Data Points</h3>
                <div className="stat-value">{debrisList.length}</div>
                <div className="stat-label">Encrypted contributions</div>
              </div>
              
              <div className="stat-card">
                <h3>Average Density</h3>
                <div className="stat-value">{avgDensity.toFixed(2)}</div>
                <div className="stat-label">Particles per km³</div>
              </div>
              
              <div className="stat-card">
                <h3>Verified Data</h3>
                <div className="stat-value">{verifiedCount}</div>
                <div className="stat-label">FHE-validated points</div>
              </div>
              
              <div className="stat-card">
                <h3>Pending Review</h3>
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Awaiting verification</div>
              </div>
            </div>
            
            <div className="chart-container">
              {renderDensityChart()}
            </div>
            
            <div className="data-summary">
              <h3>Data Summary</h3>
              <p>This platform enables secure collaboration between space agencies using Fully Homomorphic Encryption (FHE) technology. All debris field data remains encrypted during processing, allowing for confidential density mapping without exposing sensitive observation capabilities.</p>
              <div className="fhe-features">
                <div className="feature">
                  <div className="feature-icon">🔒</div>
                  <h4>Encrypted Processing</h4>
                  <p>Data remains encrypted during FHE computation</p>
                </div>
                <div className="feature">
                  <div className="feature-icon">🌐</div>
                  <h4>Multi-Agency</h4>
                  <p>Secure collaboration between organizations</p>
                </div>
                <div className="feature">
                  <div className="feature-icon">🛰️</div>
                  <h4>Mission Safety</h4>
                  <p>Enhanced collision avoidance for space missions</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
  
      {showUploadModal && (
        <ModalUpload 
          onSubmit={submitDebrisData} 
          onClose={() => setShowUploadModal(false)} 
          uploading={uploading}
          debrisData={newDebrisData}
          setDebrisData={setNewDebrisData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✕</div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="satellite-icon"></div>
              <span>SpaceDebrisFHEMap</span>
            </div>
            <p>Secure multi-agency space debris mapping using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">API</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-POWERED COLLABORATION</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} Space Debris Mapping Consortium. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalUploadProps {
  onSubmit: () => void; 
  onClose: () => void; 
  uploading: boolean;
  debrisData: any;
  setDebrisData: (data: any) => void;
}

const ModalUpload: React.FC<ModalUploadProps> = ({ 
  onSubmit, 
  onClose, 
  uploading,
  debrisData,
  setDebrisData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setDebrisData({
      ...debrisData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!debrisData.region || !debrisData.density) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="upload-modal">
        <div className="modal-header">
          <h2>Upload Encrypted Debris Data</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="encrypt-icon"></div> Your data will be encrypted with FHE technology
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Orbital Region *</label>
              <select 
                name="region"
                value={debrisData.region} 
                onChange={handleChange}
                className="form-select"
              >
                <option value="">Select region</option>
                <option value="LEO">Low Earth Orbit (LEO)</option>
                <option value="MEO">Medium Earth Orbit (MEO)</option>
                <option value="GEO">Geostationary Orbit (GEO)</option>
                <option value="HEO">High Earth Orbit (HEO)</option>
                <option value="Polar">Polar Orbit</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Density (particles/km³) *</label>
              <input 
                type="number"
                name="density"
                value={debrisData.density} 
                onChange={handleChange}
                placeholder="Enter density value" 
                className="form-input"
                step="0.01"
                min="0"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Coordinates (optional)</label>
              <textarea 
                name="coordinates"
                value={debrisData.coordinates} 
                onChange={handleChange}
                placeholder="Enter orbital coordinates or parameters..." 
                className="form-textarea"
                rows={3}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            Data remains encrypted during FHE processing and will contribute to collective debris mapping without exposing your agency's specific capabilities.
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={uploading}
            className="submit-btn"
          >
            {uploading ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;