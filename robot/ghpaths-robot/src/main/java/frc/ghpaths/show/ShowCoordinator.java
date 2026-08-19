package frc.ghpaths.show;

import edu.wpi.first.networktables.NetworkTableInstance;
import edu.wpi.first.wpilibj.DriverStation;
import frc.ghpaths.Constants;

/**
 * ShowCoordinator —— 机器人侧演出总协调（每 20ms 由 Robot.robotPeriodic 调用）。
 *
 * 运动许可链（与 sim/fake-robot 完全一致,八关探针验证过的语义）：
 *   moving = DS 使能 ∧ NT 未冻结 ∧ 演出进行中 ∧ 无故障
 *   （演出进行中 = 已开演 ∧ 到 tStart 时刻 ∧ 时钟新鲜且在走）
 * 任何一环断即停,兜底方向单调（全部往"停"收敛）;断链时对驱动层显式下发停。
 *
 * Phase 0 骨架：轨迹跟随为占位（TODO 标注）;链路/时钟/命令/围栏/上报已完整。
 * Phase 2 接 PathPlannerLib 后,trajectoryPoseAt() 换成真实路径跟随。
 */
public final class ShowCoordinator {
    private final ShowClock clock;
    private final ShowCommandReceiver cmd;
    private final TelemetryPublisher telemetry;
    private final DriveInterface drive;

    /** 当前位姿（Phase 0 由占位提供;真实机器人接 odometry） */
    private double xM, yM, headingRad;
    /** pose 上报用的演出时钟（仅实际运动时推进;sim 的 lastTShowUs 同语义） */
    private double lastMovingTShowS;
    private boolean wasStopped;

    public ShowCoordinator(TelemetryPublisher telemetry) {
        NetworkTableInstance nt = NetworkTableInstance.getDefault();
        this.clock = new ShowClock(nt);
        this.cmd = new ShowCommandReceiver(nt);
        this.telemetry = telemetry;
        this.drive = null; // Phase 0 无驱动（台架验证）;Phase 2 注入 DriveSubsystem
        this.wasStopped = true;
    }

    public void tick() {
        clock.tick();
        cmd.tick();

        // 状态转换联动：stop → 清时钟锚点（主控随后发归零时钟,按全新首样接受）;
        //              arm → 复位时钟故障（stop→arm 是唯一故障解除路径,与 sim 一致）
        if (cmd.state() == ShowCommandReceiver.ShowState.STOPPED && !wasStopped) {
            clock.onShowStop();
            lastMovingTShowS = 0;
        }
        wasStopped = cmd.state() == ShowCommandReceiver.ShowState.STOPPED;
        if (cmd.state() == ShowCommandReceiver.ShowState.ARMED && clock.isFaulted()) {
            clock.resetFault();
        }

        // ---- 运动许可链 ----
        boolean dsPermits = dsEnabled();
        boolean showStarted = cmd.state() == ShowCommandReceiver.ShowState.RUNNING
            || cmd.state() == ShowCommandReceiver.ShowState.HELD;
        boolean clockPermits = clock.isFresh() && clock.isRunning()
            && clock.tShowS() >= cmd.tStartShowS();
        boolean noFault = !clock.isFaulted() && cmd.fault().isEmpty();
        boolean moving = dsPermits && !cmd.ntFrozen() && showStarted && clockPermits && noFault;

        // ---- 地理围栏（超界即停+fault;报告 §六.4）----
        double fenceX = Constants.STAGE_WIDTH_M / 2 - Constants.GEOFENCE_RADIUS_M - Constants.GEOFENCE_MARGIN_M;
        double fenceY = Constants.STAGE_DEPTH_M / 2 - Constants.GEOFENCE_RADIUS_M - Constants.GEOFENCE_MARGIN_M;
        boolean insideFence = Math.abs(xM) <= fenceX && Math.abs(yM) <= fenceY;

        // ---- 就位检查（start 后须在路径起点附近;>0.15m 拒绝——与 sim 一致）----
        // Phase 0: 路径未装载,起点未知 → 不检查
        // TODO(Phase 2): if (cmd.state() == RUNNING && distanceToPathStart() > 0.15)
        //     cmd.setFault("不在路径起点,需重新就位");

        // ---- 轨迹跟随 / 停 ----
        if (moving && insideFence && drive != null) {
            lastMovingTShowS = clock.tShowS();
            // TODO(Phase 2): targetPose = trajectoryPoseAt(clock.tShowS());
            //                drive.follow(targetPose);  // 速度/加速度上限在 Drive 层硬限
        } else if (drive != null) {
            drive.stop(); // 许可断开对执行器显式停（防御"保持最后指令值"型驱动）
        }
        // Phase 0: drive=null,位姿由 odometry 更新——这里只做链路验证,位姿不变

        // ---- 20ms 上报（字段语义与 fake-robot 逐项对齐）----
        String showState = deriveShowState(showStarted, moving);
        String fault = !clock.fault().isEmpty() ? clock.fault() : cmd.fault();
        if (!insideFence) {
            moving = false;
            fault = String.format("越界 (%.2f, %.2f) 围栏 ±%.2f×±%.2f", xM, yM, fenceX, fenceY);
        }
        telemetry.publish(xM, yM, headingRad, lastMovingTShowS,
            DriverStation.isDSAttached(), DriverStation.isEnabled(), DriverStation.isEStopped(),
            showState, clock.isFresh(), fault);
    }

    private String deriveShowState(boolean showStarted, boolean moving) {
        if (cmd.state() == ShowCommandReceiver.ShowState.STOPPED) return "stopped";
        if (cmd.state() == ShowCommandReceiver.ShowState.IDLE) return "idle";
        if (cmd.state() == ShowCommandReceiver.ShowState.ARMED) return "armed";
        return moving ? "running" : "held";
    }

    /** DS 使能状态（autonomous 模式;表演全自动驾驶——teleop 不动作） */
    private static boolean dsEnabled() {
        return DriverStation.isEnabled()
            && DriverStation.isAutonomous()
            && !DriverStation.isEStopped();
    }

    /** Phase 2 注入:位姿来源（odometry）与驱动接口 */
    public interface DriveInterface {
        /** 跟随目标位姿;实现方必须执行速度/加速度硬上限（Constants.MAX_*） */
        void follow(double targetXM, double targetYM, double targetHeadingRad);
        /** 显式停（运动许可断开时由协调器调用;实现方必须立即撤销执行器输出） */
        void stop();
        /** 当前位姿（世界坐标,与 field-model 一致） */
        double poseXM();
        double poseYM();
        double poseHeadingRad();
    }
}
