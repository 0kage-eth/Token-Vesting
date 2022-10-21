# TOKEN-VESTING


## Contract

- [TokenVesting.sol](./contracts/TokenVesting.sol) contract is a general purpose token vesting contract that can be used to timelock tokens and release them over time. This contract is useful to manage token vesting for founders, advisors, early investors etc

- This contract is inspired from [OpenZeppelin Timelock Contract](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC20/utils/TokenTimelock.sol). I have added following elements in contract
    - Ability to define multiple vesting schedules for same beneficiary
    - Ability to revoke a token vesting agreement - incase a contract is revoked, all vested tokens as on date are released to beneficiary & vesting ceases. All unvested tokens are now released back to the token vesting contract
    - Ability to release any specific amount of tokens - both contract owner and intended beneficiary can access the 'release' function

- [ZeroKageMock.sol](./contracts/test/ZeroKage.sol) contract is a mock ERC20 contract deployed to test vesting. Vesting happens in this token.

----

## Tests

- <ins>Unit tests</ins> You can find all unit tests [here](./test/unit/vesting.unit.test.ts). Tests mainly focus on create, revoke and release methods, errors and event emissions. Note that all unit tests only run on local chain

- <ins>Integration test</ins> A full walkthrough integration test is written [here](./test/integration/vesting.integration.test.local.ts). I have explained the steps in the walkthrough


----

`## Scripts`

- For ease of testing, I have created a few scripts
    - [Move Time](./scripts/moveTime.ts) allows devs to shift time in blockchain. Since these contracts are vested over time, this will be very useful script to change time and check calculations

    - [Publish Contracts To Front End](./scripts/publishContractsToFrontEnd.ts) exports contract abi and address to a specific location that can be specified in the [constants.ts](./constants.ts) file.

    - [Capitalize vesting contract](./scripts/capitalizeVestingContract.ts) allows users to transfer tokens from deployer to TokenVesting contract - Vesting only works if contract has adequate balance to vest

    - [Create Vesting Schedule](./scripts/createdVestingSchedule.ts) allows users to create a new vesting schedule from back end



----


## Key points

- As always, create your .env file. Template for this is provided in .env.example file
- If you find any issues, please add comments
- Demo link for this code (front end) is here : 
- Goerli contract address: 0x7ec777324AAA80C90550656552b2bA4B3d206030


