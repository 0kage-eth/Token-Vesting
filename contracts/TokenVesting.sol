//SPDX-License-Identifier:MIT

pragma solidity 0.8.7;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";


contract TokenVesting is Ownable{

    using SafeMath for uint256;
    using SafeERC20 for IERC20;


    // create a struct for vesting schedule

    /**
     * @notice token vesting contract - generic template based on openzeppelin token vesting contract
     * @notice this contract is general purpose & can handle multiple vesting schedules for multiple addresses
     * @dev general functionality
     *      - Create Vesting Schedule
     *      - Revoke Vesting Schedule
     *      - Release Vested Tokens - can be called by owner of beneficiary
     *      - Check released and unreleased tokens
     * 
     * 
     * @notice this can be used to vest founders, advisors, investors etc
     */
    struct VestingSchedule {

        // valid schedule only if initialized flag is TRUE
        bool initialized;

        // address of beneficiary of vesting
        address beneficiary;


        // cliff period - period in which no tokens are accrued
        uint256 cliff;

        // time when vesting starts - if not given, vestingStart will be initialized to txn minting
        uint256 vestingStart;

        // time when vesting ends - all tokens must be released when time == vestingEnd
        uint256 vestingEnd;

        // vesting time unit - vesting is calculated after every time unit
        uint256 vestingTimeUnit;

        // if revocable- false, no changes can be made to vesting schedule
        bool revocable;

        // tokens allocated for an address - that will be vested from start -> end
        uint256 allocated;

        // tokens released as on last vesting calculation
        uint256 released;

        // vesting revoked or not
        bool revoked;
    }

    //********* CUSTOM ERRORS **************/
    error TokenVesting__VestingScheduleNotFound(address beneficiary);
    error TokenVesting__VestingScheduleRevoked(address beneficiary);
    error TokenVesting__InsufficientBalance(address beneficiary, uint256 balance, uint256 vesting);

    // ERC20 token that will be vested 
    IERC20 immutable private i_token;

    // vesting schedule ID's
    // id is a bytes32 variable uniquely defined by combination of address and a countery
    // for every new schedule Id assigned to a user, id counter increases
    bytes32[] private s_vestingScheduleIds;

    // mapps an id -> vesting schedule
    mapping(bytes32 => VestingSchedule) private s_vestingSchedules;

    
    // total vested amount this contract manages
    uint256 private s_totalVested;

    // number of vesting schedules tagged to a given user
    mapping(address => uint32) s_vestingSchedulesPerUser;


    event Released(address beneficiary, uint256 releaseAmount);

    event Revoked(address beneficiary, uint256 vestedAmount, uint256 unreleasedAmount);

    //******************* MODIFIERS *********************//
    // check if vesting schedule exists
    modifier vestingScheduleExists(bytes32 vestingScheduleId){
        if(!s_vestingSchedules[vestingScheduleId].initialized){
            revert TokenVesting__VestingScheduleNotFound(msg.sender);
        }
        _;
    }

    // check if vesting schedule is not revoked
    modifier vestingScheduleNotRevoked(bytes32 vestingScheduleId) {
        if(!s_vestingSchedules[vestingScheduleId].initialized){
            revert TokenVesting__VestingScheduleNotFound(msg.sender);
        }
        if(s_vestingSchedules[vestingScheduleId].revoked){
            revert TokenVesting__VestingScheduleRevoked(msg.sender);
        }
        _;
    }
//-----------------------------------------------------------//



//******************** CONSTRUCTOR *************************//
/**
 * @dev passing the token address of ERC20 that will be vested via this contract
 */
constructor (address tokenAddress){
    require(tokenAddress != address(0x0), "Invalid token address");
    i_token = IERC20(tokenAddress);
}


//******************* MUTATIVE FUNCTIONS *********************//

function createVestingSchedule(
    address beneficiary,
    uint256 startTime,
    uint256 cliff,
    uint256 duration,
    uint256 vestingTimeUnit,
    bool revocable,
    uint256 vestedAmount
) public onlyOwner{

    //**** error checks */ 

    // 1. amount < withdrawable balance. Vesting can be created only if amount < withdrawal balance
    uint256 balance = getWithdrawableBalance();
    if(vestedAmount > balance){
        revert TokenVesting__InsufficientBalance(beneficiary, balance, vestedAmount );        
    }

    // 2. duration > 0
    require(duration > 0, "Invalid vesting duration. Enter valid value in seconds");

    // 3. vestedAmount > 0
    require(vestedAmount > 0, "Invalid vesting amount. Enter value > 0");

    // 4. vestingTimeUnit >= 1 -> inidvidual time unit (in seconds) when vesting values are calculated
    require(vestingTimeUnit > 0, "Invalid vesting time interval in seconds");
    //------------------//
    // 

    // next valid id that can be created for beneficiary
    bytes32 id = getNextScheduleIdForBeneficiary(beneficiary);
    uint256 cliffAbsolute = startTime.add(cliff);
    uint256 endTime = startTime.add(duration);
    s_vestingSchedules[id] = VestingSchedule(true,
                                beneficiary,
                                cliffAbsolute,
                                startTime,
                                endTime,
                                vestingTimeUnit,
                                revocable,
                                vestedAmount,
                                0,
                                false);

    s_totalVested = s_totalVested.add(vestedAmount);
    s_vestingScheduleIds.push(id);
    s_vestingSchedulesPerUser[beneficiary] += 1;
}

function revoke(bytes32 vestingScheduleId) public onlyOwner vestingScheduleNotRevoked(vestingScheduleId) {
    VestingSchedule storage schedule = s_vestingSchedules[vestingScheduleId];

    require(schedule.revocable, "This vesting schedule is not revocable");

    uint256 vestedAmount = computeReleasableAmount(schedule);

    // if there is exising releasable amount
    // first we release that amount
    if(vestedAmount > 0){
        release(vestingScheduleId, vestedAmount);
    }

    // calculate the unvested amount -> this is the amount that was supposed to vest in future

    uint256 unvestedAmount = allocated.sub(schedule.released);

    // this is no longer to be allocated - reduce this from total vested amount managed by this contract
    s_totalVested = s_totalVested.sub(unvestedAmount);

    // finally, set revoke status to true - this prevents further calculation of vesting amount
    // for all purposes - this schedule is closed
    schedule.revoked = true;




}

function release(bytes32 vestingScheduleId, uint256 amount) public nonReentrant vestingScheduleNotRevoked(vestingScheduleId){
    VestingSchedule storage schedule = s_vestingSchedules[vestingScheduleId];

    require(amount > 0, "Invalid release amount");
    require(msg.sender == schedule.beneficiary || msg.sender == owner(), "Only beneficiary or owner authorized to release vested tokens");

    // compute vested amount that is releasable
    uint256 vestedAmount = computeReleasableAmount(schedule);

    // amount cannot be more than vested amount against this vesting schedule
    require(vestedAmount >= amount, "Tokens specified are more than your vested balance");


    uint256 released = schedule.released;
    // reduce release amount of the current schedule
    schedule.released = released.add(amount);

    // reduce total vested amount handled by contract
    s_totalVested = s_totalVested.sub(amount);

    address payable payableBeneficiary = payable(schedule.beneficiary);

    // safe transfer of tokens from current address to beneficiary
    i_token.safeTransfer(payableBeneficiary, amount);

}

function withdraw(uint256 amount) onlyOwner nonReentrant{
    require(amount<= getWithdrawableBalance(), "Amount exceeds withdrawable balance needed to honor vesting contracts");

    i_token.transfer(owner(), amount);
}


//-------------------------------------------------------------//

//******************* INTERNAL HELPER FUNCTIONS *****************/
    
    /**
     * @dev used to calculate already vested amount 
     */
    function computeReleasableAmount(VestingSchedule memory schedule) internal view returns(uint256){

        uint256 currentTime = block.timestamp;

        // if contract is within cliff -> nothing is vested
        // if contract status is revoked - no further vesting
        // in both cases, just simply return 0
        if(currentTime < schedule.cliff  || schedule.revoked){
            return 0;
        }

        // if vesting end time has passed
        // all the unreleased tokens have completed vesting & hence are available for release
        else if(currentTime >= schedule.vestingEnd){
            return schedule.allocated.sub(schedule.released);
        }
        else{
            uint256 timeFromStart = currentTime.sub(schedule.vestingStart);
            uint256 vestingTimeUnit = schedule.vestingTimeUnit;

            uint256 completedVestingCycles = timeFromStart.div(vestingTimeUnit);
            uint256 totalCycles = (schedule.vestingEnd.sub(schedule.vestingStart)).div(vestingTimeUnit);    

            // vested amount is proportional to cycles completed
            uint256 vestedAmount = schedule.allocated.mul(completedVestingCycles).div(totalCycles);

            // subtract already released amount from this calculated value
            // current value is from inception - to calculated unreleased value, we need to subtract released value
            vestedAmount = vestedAmount.sub(schedule.released);
            return vestedAmount;
        }
    }


//-------------------------------------------------------------//

//******************* GET FUNCTIONS ************************//

 /**
  * @dev function gives count of vesting schedules per beneficiary
  * @param beneficiary address of beneficiary
  * @return count of vesting schedules for a given beneficiary
  **/

 function getCountPerBeneficiary(address beneficiary) public returns(uint32 count) {
     count = s_vestingSchedulesPerUser[beneficiary];   
 }


 /**
  * @dev returns vesting id given index
  * @param index 0 based index that gives vesting ID for given index
  * @return vestingScheduleId bytes32 string that indexes to a unique vesting schedule
  * */   
function getVestingIdAtIndex(uint256 index) public view returns(bytes32 vestingScheduleId) vestingScheduleExists(vestingScheduleId){
    require(index < getVestingScheduleCount(), "Index out of bounds");

    vestingScheduleId = s_vestingScheduleIds[index];
}

/**
 * @dev gets the total number of vesting schedules managed by this contract
 * @dev A single beneficiary can have multiple vesting schedules 
 * @return count gives count of vesting schedule */    
function getVestingScheduleCount() public view returns(uint256 count){
    count = s_vestingScheduleIds.length;
}


function getVestingScheduleIdForAddressAndIndex(address beneficiary, uint32 index) internal view returns(bytes32 id){
    id = getId(beneficiary, index);
}

function getVestingScheduleForAddressAndIndex(address beneficiary, uint32 index) internal view returns(VestingSchedule memory schedule){
    schedule = getVestingSchedule(getId(beneficiary, index));
}

function getVestingSchedule(bytes32 id) public view returns (VestingSchedule memory vestingSchedule) vestingScheduleExists(id){
    vestingSchedule = s_vestingSchedules[id];
}

function getId(address beneficiary, uint32 index) public view returns(bytes32 id){
    id = keccak256(abi.encodePacked(beneficiary, index));
}

function getTotalVestedAmount() public view returns(uint256 total){
    total = s_totalVested;
}


function getVestedToken() public view returns(address token){

    token = address(i_token);
}

/**
 * @notice returns balance that can be withdrawn from address
 * @notice only that balance can be removed that is unencumbered, meaning that is not currently commited to a beneficiary...
 * @notice  ... as part of vesting contract
 * @notice this number is important to know before we add any new vesting schedules
 */
function getWithdrawableBalance() public view returns(uint256 balance){

    uint256 accntBalance = i_token.balanceOf(address(this));
    balance = accntBalance - s_totalVested;
}

function getNextScheduleIdForBeneficiary(address beneficiary) internal view returns(bytes32 id){
    id = getVestingScheduleIdForAddressAndIndex(beneficiary, s_vestingSchedulesPerUser[beneficiary]);
}


//---------------------------------------------------------//

// ******************* FALLBACK FUNCTIONS *********************//

receive() external payable{

}

fallback() external payable {

}

}
