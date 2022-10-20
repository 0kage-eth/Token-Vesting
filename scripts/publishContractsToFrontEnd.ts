import { ethers, network } from "hardhat"
import * as fs from "fs"
import { REACT_APP_FOLDER_PATH } from "../constants"

const deploymentsDir = "./deployments"

const publishToFrontend = async (destinationFolder: string) => {
    if (fs.existsSync(deploymentsDir)) {
        const directories = fs.readdirSync(deploymentsDir)

        directories.map((dir) => {
            if (dir.indexOf("DS_Store") > 0) {
                // skip if its a .DS_Store file
            } else {
                const networkName = dir
                const files = fs.readdirSync(`${deploymentsDir}/${dir}`)
                let chainId: string
                // first search for chainId file and populate chainId
                let chainIdFile = files.find((file) => file.includes("chainId"))
                if (chainIdFile) {
                    chainId = fs.readFileSync(`${deploymentsDir}/${dir}/.chainId`, "utf8")

                    // destination folder should have a contracts sub-folder
                    // if no such folder, create one

                    if (!fs.existsSync(`${destinationFolder}/contracts`)) {
                        fs.mkdirSync(`${destinationFolder}/contracts`)
                    }

                    // go through all json files that contain contract address and abis
                    files.map((file) => {
                        let contractAddress
                        let contractAbi
                        let contractName

                        if (file.includes(".json")) {
                            contractName = file.replace(".json", "")
                            const fileContentObject = JSON.parse(
                                fs.readFileSync(`${deploymentsDir}/${dir}/${file}`, "utf8")
                            )
                            contractAddress = fileContentObject.address || ""
                            contractAbi = fileContentObject.abi || ""

                            if (contractAddress && contractAbi && contractName) {
                                const contractJson = `${destinationFolder}/contracts/${networkName}_${contractName}.json`

                                // write contract ABI to contracts folder
                                fs.writeFileSync(contractJson, JSON.stringify(contractAbi))

                                // append address to a contract name, if it exists
                                // if it does not, create a new element in the addressesObj
                                const addressesJson = `${destinationFolder}/contracts/addresses.json`
                                let addressesObj

                                if (fs.existsSync(addressesJson)) {
                                    addressesObj = JSON.parse(
                                        fs.readFileSync(addressesJson, "utf8")
                                    )
                                } else {
                                    addressesObj = JSON.parse("{}")
                                }
                                if (chainId in addressesObj) {
                                    if (contractName in addressesObj[chainId]) {
                                        const isIncluded =
                                            addressesObj[chainId][contractName].includes(
                                                contractAddress
                                            )
                                        if (!isIncluded) {
                                            addressesObj[chainId][contractName].push(
                                                contractAddress
                                            )
                                        }
                                    } else {
                                        addressesObj[chainId][contractName] = [contractAddress]
                                    }
                                } else {
                                    addressesObj[chainId] = { [contractName]: [contractAddress] }
                                }

                                fs.writeFileSync(addressesJson, JSON.stringify(addressesObj))
                            }
                        }
                    })
                }
            }
        })
    }
}

publishToFrontend(REACT_APP_FOLDER_PATH)
    .then(() => {
        console.log("Contract address and abi published to frontend")
        process.exit(0)
    })
    .catch((e) => {
        console.log(e)
        process.exit(1)
    })
