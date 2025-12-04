// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract DebrisMapFHE is SepoliaConfig {
    struct EncryptedObservation {
        uint256 id;
        address provider;
        euint32 encryptedXCoord;
        euint32 encryptedYCoord;
        euint32 encryptedZCoord;
        euint32 encryptedDensity;
        uint256 timestamp;
    }

    struct DensityMap {
        euint32[][][] encryptedDensityGrid;
        uint256 gridResolution;
        bool isRevealed;
    }

    mapping(address => bool) public authorizedProviders;
    mapping(uint256 => EncryptedObservation) public observations;
    DensityMap public globalDensityMap;
    uint256 public observationCount;
    
    mapping(uint256 => uint256) private requestToObservation;
    mapping(uint256 => address) private requestToProvider;

    event ObservationSubmitted(uint256 indexed id, address indexed provider);
    event MapCalculationRequested(address indexed requester);
    event DensityMapUpdated(uint256 gridResolution);
    event MapRevealed(uint256 gridResolution);

    modifier onlyAuthorized() {
        require(authorizedProviders[msg.sender], "Unauthorized provider");
        _;
    }

    constructor() {
        // Initialize with empty density map
        globalDensityMap.gridResolution = 10; // Default resolution
        globalDensityMap.isRevealed = false;
    }

    /// @notice Authorize a new data provider
    function authorizeProvider(address provider) public {
        authorizedProviders[provider] = true;
    }

    /// @notice Submit encrypted space debris observation
    function submitObservation(
        euint32 xCoord,
        euint32 yCoord,
        euint32 zCoord,
        euint32 density
    ) public onlyAuthorized {
        observationCount++;
        observations[observationCount] = EncryptedObservation({
            id: observationCount,
            provider: msg.sender,
            encryptedXCoord: xCoord,
            encryptedYCoord: yCoord,
            encryptedZCoord: zCoord,
            encryptedDensity: density,
            timestamp: block.timestamp
        });

        emit ObservationSubmitted(observationCount, msg.sender);
    }

    /// @notice Request density map calculation
    function calculateDensityMap(uint256 resolution) public {
        require(resolution > 0 && resolution <= 100, "Invalid resolution");
        globalDensityMap.gridResolution = resolution;

        bytes32[] memory ciphertexts = new bytes32[](observationCount * 4);
        for (uint i = 1; i <= observationCount; i++) {
            ciphertexts[(i-1)*4] = FHE.toBytes32(observations[i].encryptedXCoord);
            ciphertexts[(i-1)*4+1] = FHE.toBytes32(observations[i].encryptedYCoord);
            ciphertexts[(i-1)*4+2] = FHE.toBytes32(observations[i].encryptedZCoord);
            ciphertexts[(i-1)*4+3] = FHE.toBytes32(observations[i].encryptedDensity);
        }

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.processObservations.selector);
        requestToProvider[reqId] = msg.sender;

        emit MapCalculationRequested(msg.sender);
    }

    /// @notice Process decrypted observations to build density map
    function processObservations(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        address requester = requestToProvider[requestId];
        require(requester != address(0), "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32[] memory values = abi.decode(cleartexts, (uint32[]));
        
        // Initialize 3D density grid
        uint256 res = globalDensityMap.gridResolution;
        globalDensityMap.encryptedDensityGrid = new euint32[][][](res);
        
        for (uint x = 0; x < res; x++) {
            globalDensityMap.encryptedDensityGrid[x] = new euint32[][](res);
            for (uint y = 0; y < res; y++) {
                globalDensityMap.encryptedDensityGrid[x][y] = new euint32[](res);
                for (uint z = 0; z < res; z++) {
                    // Simplified density calculation
                    globalDensityMap.encryptedDensityGrid[x][y][z] = FHE.asEuint32(0);
                }
            }
        }

        // Process each observation (simplified)
        for (uint i = 0; i < values.length / 4; i++) {
            uint32 x = values[i*4];
            uint32 y = values[i*4+1];
            uint32 z = values[i*4+2];
            uint32 density = values[i*4+3];

            // Simplified grid assignment
            uint gridX = x % res;
            uint gridY = y % res;
            uint gridZ = z % res;

            globalDensityMap.encryptedDensityGrid[gridX][gridY][gridZ] = 
                FHE.add(globalDensityMap.encryptedDensityGrid[gridX][gridY][gridZ], FHE.asEuint32(density));
        }

        emit DensityMapUpdated(res);
    }

    /// @notice Request density map reveal
    function requestMapReveal() public {
        require(!globalDensityMap.isRevealed, "Map already revealed");

        uint256 res = globalDensityMap.gridResolution;
        bytes32[] memory ciphertexts = new bytes32[](res * res * res);
        
        uint counter = 0;
        for (uint x = 0; x < res; x++) {
            for (uint y = 0; y < res; y++) {
                for (uint z = 0; z < res; z++) {
                    ciphertexts[counter] = FHE.toBytes32(globalDensityMap.encryptedDensityGrid[x][y][z]);
                    counter++;
                }
            }
        }

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.finalizeReveal.selector);
        requestToProvider[reqId] = msg.sender;
    }

    /// @notice Finalize map reveal
    function finalizeReveal(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        address requester = requestToProvider[requestId];
        require(requester != address(0), "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        globalDensityMap.isRevealed = true;
        emit MapRevealed(globalDensityMap.gridResolution);
    }

    /// @notice Get observation count
    function getObservationCount() public view returns (uint256) {
        return observationCount;
    }

    /// @notice Check if map is ready
    function isMapReady() public view returns (bool) {
        return globalDensityMap.encryptedDensityGrid.length > 0;
    }
}