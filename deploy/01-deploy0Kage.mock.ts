import { deployments, ethers, getNamedAccounts, network } from "hardhat"
import { developmentChains } from "../helper-hardhat-config"

const deployZeroKageMock = async () => {
    const { deploy, log } = deployments
    const { deployer } = await getNamedAccounts()

    if (developmentChains.includes(network.name)) {
        log("Detected local chain..")
        log("Deploying Zerokage mock contract...")
        const args = [ethers.utils.parseEther("1000000")]
        const tx = await deploy("ZeroKageMock", {
            log: true,
            args: args,
            from: deployer,
            waitConfirmations: 1,
        })

        console.log("ZeroKage Mock deployed successfully")

        log("----------------------")
    }
}

export default deployZeroKageMock

deployZeroKageMock.tags = ["main", "0Kage"]
