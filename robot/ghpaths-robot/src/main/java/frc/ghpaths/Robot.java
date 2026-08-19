package frc.ghpaths;

import edu.wpi.first.wpilibj.TimedRobot;
import edu.wpi.first.wpilibj.Timer;
import frc.ghpaths.show.ShowCoordinator;
import frc.ghpaths.show.TelemetryPublisher;

/**
 * GHPaths 演出机器人主类。
 *
 * 职责边界（architecture.md）：
 *  - 只通过 show-protocol 定义的 NT4 topics 与演控交互；
 *  - 以演出时钟驱动轨迹（不用本地时钟），断时钟即停；
 *  - 表演安全项：速度/加速度硬上限 + 地理围栏（robot/README 约束）。
 */
public class Robot extends TimedRobot {
    private ShowCoordinator show;
    private TelemetryPublisher telemetry;

    @Override
    public void robotInit() {
        telemetry = new TelemetryPublisher();
        show = new ShowCoordinator(telemetry);
        System.out.println("[ghpaths] robotInit: team=" + Constants.teamNumber()
            + " stage=" + Constants.STAGE_WIDTH_M + "×" + Constants.STAGE_DEPTH_M + "m");
    }

    @Override
    public void robotPeriodic() {
        // 20ms 主循环：收时钟/命令 → 判定运动许可 → 跟随轨迹 → 发布位姿/健康
        show.tick();
        telemetry.tick();
    }

    @Override
    public void autonomousInit() {
        System.out.println("[ghpaths] autonomous enabled (DS)");
    }

    @Override
    public void disabledInit() {
        // DS 失能（multi-DS disable/estop/看门狗）——运动许可自动收回,无需额外处理
        System.out.println("[ghpaths] disabled (DS)");
    }

    @Override
    public void teleopInit() {
        // 表演全自动驾驶:teleop 模式不应出现;出现则不动作（运动许可要求 autonomous）
        System.out.println("[ghpaths] WARNING: teleop enabled — show expects autonomous mode only");
    }

    /** 本地时钟（诊断/日志用;轨迹驱动只用演出时钟） */
    public static double localTime() {
        return Timer.getFPGATimestamp();
    }
}
